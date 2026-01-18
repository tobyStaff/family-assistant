// src/plugins/dailySummary.ts
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import fastifyCron from 'fastify-cron';
import { generatePersonalizedSummary } from '../utils/personalizedSummaryBuilder.js';
import { renderPersonalizedEmail } from '../templates/personalizedEmailTemplate.js';
import { sendInboxSummary } from '../utils/emailSender.js';
import { getAllUserIds } from '../db/authDb.js';
import { getUser } from '../db/userDb.js';
import { getAuth } from '../db/authDb.js';
import { decrypt } from '../lib/crypto.js';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { cleanupExpiredSessions } from '../db/sessionDb.js';
import { getOrCreateDefaultSettings } from '../db/settingsDb.js';
import { fetchAndStoreEmails, syncProcessedLabels } from '../utils/emailStorageService.js';
import { analyzeUnanalyzedEmails } from '../parsers/twoPassAnalyzer.js';

/**
 * Get user's OAuth2 client
 * Fetches encrypted tokens from database and creates OAuth2Client
 *
 * @param userId - User ID
 * @returns OAuth2Client with tokens
 */
async function getUserAuth(userId: string): Promise<OAuth2Client> {
  // Fetch encrypted tokens from database
  const authEntry = getAuth(userId);
  if (!authEntry) {
    throw new Error(`No auth found for user ${userId}`);
  }

  // Decrypt tokens (stored as "iv:content")
  const decryptToken = (encryptedData: string): string => {
    const [iv, content] = encryptedData.split(':');
    if (!iv || !content) {
      throw new Error('Invalid encrypted token format');
    }
    return decrypt(content, iv);
  };

  const refreshToken = decryptToken(authEntry.refresh_token);
  const accessToken = authEntry.access_token
    ? decryptToken(authEntry.access_token)
    : undefined;

  // Create OAuth2Client
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
    access_token: accessToken ?? null,
    expiry_date: authEntry.expiry_date?.getTime() ?? null,
  });

  return oauth2Client;
}

/**
 * Get user's email address from database
 *
 * @param userId - User ID
 * @returns User email address
 */
async function getUserEmail(userId: string): Promise<string> {
  const user = getUser(userId);
  if (!user) {
    throw new Error(`No user found for user ${userId}`);
  }
  return user.email;
}

/**
 * Daily Summary Cron Plugin
 * Sends automated daily summaries of upcoming TODOs and events
 *
 * Runs daily at 8:00 AM UTC (configurable via CRON_SCHEDULE env var)
 */
async function dailySummaryPlugin(fastify: FastifyInstance) {
  // Register fastify-cron plugin
  // @ts-ignore - fastify-cron has incomplete type definitions
  await fastify.register(fastifyCron, {
    jobs: [
      {
        // Cron schedule: Daily at 8:00 AM UTC (can be configured via env)
        // Format: second minute hour day-of-month month day-of-week
        cronTime: process.env.CRON_SCHEDULE || '0 0 8 * * *',

        // Job name for logging and manual triggering
        name: 'daily-summary',

        // Main cron job function
        onTick: async function () {
          fastify.log.info('Starting daily summary cron job');

          try {
            // Get all users with stored auth
            const userIds = getAllUserIds();
            fastify.log.info(`Processing daily summaries for ${userIds.length} users`);

            let successCount = 0;
            let errorCount = 0;

            // Process each user
            for (const userId of userIds) {
              try {
                // Get user's settings
                const settings = getOrCreateDefaultSettings(userId);

                // Check if summary is enabled
                if (!settings.summary_enabled) {
                  fastify.log.debug({ userId }, 'Skipping user - daily summary disabled in settings');
                  continue;
                }

                // Check if there are any recipients configured
                if (settings.summary_email_recipients.length === 0) {
                  fastify.log.debug({ userId }, 'Skipping user - no email recipients configured');
                  continue;
                }

                // Get user's OAuth2 client
                const auth = await getUserAuth(userId);

                // Generate personalized summary (uses stored events/todos from database)
                const summary = await generatePersonalizedSummary(userId, 7); // Look ahead 7 days

                // Render HTML email
                const html = renderPersonalizedEmail(summary);

                // Count total items
                const totalTodos = summary.by_child.reduce((acc, child) =>
                  acc + child.urgent_todos.length + child.upcoming_todos.length, 0
                ) + summary.family_wide.urgent_todos.length + summary.family_wide.upcoming_todos.length;

                const totalEvents = summary.by_child.reduce((acc, child) =>
                  acc + child.urgent_events.length + child.upcoming_events.length, 0
                ) + summary.family_wide.urgent_events.length + summary.family_wide.upcoming_events.length;

                // Only send email if there's content
                if (totalTodos > 0 || totalEvents > 0 || summary.insights.length > 0) {
                  // Send email to all configured recipients (uses sendInboxSummary which handles multiple recipients)
                  const dummySummary = {
                    email_analysis: { total_received: 0, signal_count: 0, noise_count: 0 },
                    summary: [],
                    kit_list: { tomorrow: [], upcoming: [] },
                    financials: [],
                    calendar_updates: [],
                    attachments_requiring_review: [],
                    recurring_activities: [],
                    pro_dad_insight: '',
                  };

                  await sendInboxSummary(auth, dummySummary, html, settings.summary_email_recipients);

                  fastify.log.info(
                    {
                      userId,
                      recipientCount: settings.summary_email_recipients.length,
                      todoCount: totalTodos,
                      eventCount: totalEvents,
                      childCount: summary.by_child.length,
                    },
                    'Personalized summary sent successfully'
                  );

                  successCount++;
                } else {
                  fastify.log.debug({ userId }, 'Skipping email - no upcoming items');
                }
              } catch (userError) {
                errorCount++;
                fastify.log.error(
                  {
                    err: userError,
                    userId,
                  },
                  'Error processing daily summary for user'
                );
                // Continue processing other users even if one fails
              }
            }

            fastify.log.info(
              {
                total: userIds.length,
                success: successCount,
                errors: errorCount,
              },
              'Daily summary cron job completed'
            );
          } catch (error) {
            // Log error but don't crash the server
            fastify.log.error(
              {
                err: error,
              },
              'Fatal error in daily summary cron job'
            );
          }
        },

        // Start immediately when plugin registers
        start: true,

        // Timezone for cron schedule
        timeZone: process.env.TZ || 'UTC',
      },
      {
        // Session cleanup job
        // Cron schedule: Daily at 2:00 AM UTC
        cronTime: '0 0 2 * * *',

        // Job name for logging
        name: 'session-cleanup',

        // Main cron job function
        onTick: async function () {
          fastify.log.info('Starting session cleanup cron job');

          try {
            // Delete all expired sessions
            const deletedCount = cleanupExpiredSessions();

            fastify.log.info(
              {
                deletedCount,
              },
              'Session cleanup completed successfully'
            );
          } catch (error) {
            // Log error but don't crash the server
            fastify.log.error(
              {
                err: error,
              },
              'Error in session cleanup cron job'
            );
          }
        },

        // Start immediately when plugin registers
        start: true,

        // Timezone for cron schedule
        timeZone: 'UTC',
      },
      {
        // Daily email fetch job
        // Cron schedule: Daily at 6:00 AM UTC (before daily summary at 8:00 AM)
        cronTime: process.env.EMAIL_FETCH_SCHEDULE || '0 0 6 * * *',

        // Job name for logging
        name: 'daily-email-fetch',

        // Main cron job function
        onTick: async function () {
          fastify.log.info('Starting daily email fetch cron job');

          try {
            // Get all users with stored auth
            const userIds = getAllUserIds();
            fastify.log.info(`Processing email fetch for ${userIds.length} users`);

            let totalFetched = 0;
            let totalStored = 0;
            let totalErrors = 0;

            // Process each user
            for (const userId of userIds) {
              try {
                // Get user's OAuth2 client
                const auth = await getUserAuth(userId);

                // Fetch and store unprocessed emails (last 3 days by default)
                const result = await fetchAndStoreEmails(userId, auth, 'last3days', 500);

                totalFetched += result.fetched;
                totalStored += result.stored;
                totalErrors += result.errors;

                if (result.fetched > 0 || result.errors > 0) {
                  fastify.log.info(
                    {
                      userId,
                      fetched: result.fetched,
                      stored: result.stored,
                      skipped: result.skipped,
                      labeled: result.labeled,
                      errors: result.errors,
                    },
                    'Email fetch completed for user'
                  );
                }

                // Also sync any labels that failed previously
                if (result.stored > 0) {
                  await syncProcessedLabels(userId, auth);
                }
              } catch (error) {
                totalErrors++;
                fastify.log.error(
                  { err: error, userId },
                  'Error fetching emails for user'
                );
              }
            }

            fastify.log.info(
              {
                totalUsers: userIds.length,
                totalFetched,
                totalStored,
                totalErrors,
              },
              'Daily email fetch cron job completed'
            );
          } catch (error) {
            // Log error but don't crash the server
            fastify.log.error(
              { err: error },
              'Fatal error in daily email fetch cron job'
            );
          }
        },

        // Start immediately when plugin registers
        start: true,

        // Timezone for cron schedule
        timeZone: process.env.TZ || 'UTC',
      },
      {
        // Daily email analysis job (Two-Pass AI Analysis - Task 2)
        // Cron schedule: Daily at 7:00 AM UTC (after email fetch at 6:00 AM)
        cronTime: process.env.EMAIL_ANALYSIS_SCHEDULE || '0 0 7 * * *',

        // Job name for logging
        name: 'daily-email-analysis',

        // Main cron job function
        onTick: async function () {
          fastify.log.info('Starting daily email analysis cron job');

          try {
            // Get all users with stored auth
            const userIds = getAllUserIds();
            fastify.log.info(`Processing email analysis for ${userIds.length} users`);

            let totalProcessed = 0;
            let totalSuccessful = 0;
            let totalEvents = 0;
            let totalTodos = 0;

            // Process each user
            for (const userId of userIds) {
              try {
                // Run two-pass analysis on unanalyzed emails
                const result = await analyzeUnanalyzedEmails(userId, 'openai', 50);

                totalProcessed += result.processed;
                totalSuccessful += result.successful;
                totalEvents += result.eventsCreated;
                totalTodos += result.todosCreated;

                if (result.processed > 0) {
                  fastify.log.info(
                    {
                      userId,
                      processed: result.processed,
                      successful: result.successful,
                      failed: result.failed,
                      eventsCreated: result.eventsCreated,
                      todosCreated: result.todosCreated,
                    },
                    'Email analysis completed for user'
                  );
                }
              } catch (error) {
                fastify.log.error(
                  { err: error, userId },
                  'Error analyzing emails for user'
                );
              }
            }

            fastify.log.info(
              {
                totalUsers: userIds.length,
                totalProcessed,
                totalSuccessful,
                totalEvents,
                totalTodos,
              },
              'Daily email analysis cron job completed'
            );
          } catch (error) {
            // Log error but don't crash the server
            fastify.log.error(
              { err: error },
              'Fatal error in daily email analysis cron job'
            );
          }
        },

        // Start immediately when plugin registers
        start: true,

        // Timezone for cron schedule
        timeZone: process.env.TZ || 'UTC',
      },
      {
        // Event sync retry job
        // Cron schedule: Every 15 minutes
        cronTime: '0 */15 * * * *',

        // Job name for logging
        name: 'event-sync-retry',

        // Main cron job function
        onTick: async function () {
          fastify.log.info('Starting event sync retry cron job');

          try {
            // Import required functions
            const { getAllUserIds } = await import('../db/authDb.js');
            const { syncPendingEventsForUser } = await import('../utils/eventSyncService.js');

            // Get all users with stored auth
            const userIds = getAllUserIds();
            let totalProcessed = 0;
            let totalSynced = 0;
            let totalFailed = 0;

            // Process each user
            for (const userId of userIds) {
              try {
                // Get user's OAuth2 client
                const auth = await getUserAuth(userId);

                // Sync pending events (max 5 retries)
                const result = await syncPendingEventsForUser(userId, auth, 5);

                totalProcessed += result.processed;
                totalSynced += result.synced;
                totalFailed += result.failed;

                if (result.processed > 0) {
                  fastify.log.info(
                    { userId, ...result },
                    'Event sync completed for user'
                  );
                }
              } catch (error) {
                fastify.log.error(
                  { err: error, userId },
                  'Error syncing events for user'
                );
              }
            }

            // Log summary if any events were processed
            if (totalProcessed > 0) {
              fastify.log.info(
                {
                  totalProcessed,
                  totalSynced,
                  totalFailed,
                },
                'Event sync retry cron job completed'
              );
            }
          } catch (error) {
            // Log error but don't crash the server
            fastify.log.error(
              { err: error },
              'Fatal error in event sync retry cron job'
            );
          }
        },

        // Start immediately when plugin registers
        start: true,

        // Timezone for cron schedule
        timeZone: 'UTC',
      },
    ],
  });

  // Add route to manually trigger daily summary (for testing)
  fastify.get('/admin/trigger-daily-summary', async (_request, reply) => {
    try {
      fastify.log.info('Manually triggering daily summary job');

      // Find and execute the job
      const job = fastify.cron.getJobByName('daily-summary');

      if (job) {
        // Trigger the job manually
        job.fireOnTick();

        return reply.code(200).send({
          success: true,
          message: 'Daily summary job triggered successfully',
        });
      } else {
        return reply.code(500).send({
          error: 'Daily summary job not found',
        });
      }
    } catch (error) {
      fastify.log.error({ err: error }, 'Error triggering daily summary');
      return reply.code(500).send({
        error: 'Failed to trigger daily summary',
      });
    }
  });

  // Add route to manually trigger event sync (for testing)
  fastify.get('/admin/trigger-event-sync', async (_request, reply) => {
    try {
      fastify.log.info('Manually triggering event sync job');

      // Find and execute the job
      const job = fastify.cron.getJobByName('event-sync-retry');

      if (job) {
        // Trigger the job manually
        job.fireOnTick();

        return reply.code(200).send({
          success: true,
          message: 'Event sync job triggered successfully',
        });
      } else {
        return reply.code(500).send({
          error: 'Event sync job not found',
        });
      }
    } catch (error) {
      fastify.log.error({ err: error }, 'Error triggering event sync');
      return reply.code(500).send({
        error: 'Failed to trigger event sync',
      });
    }
  });

  // Add route to manually trigger email fetch (for testing)
  fastify.get('/admin/trigger-email-fetch', async (_request, reply) => {
    try {
      fastify.log.info('Manually triggering email fetch job');

      // Find and execute the job
      const job = fastify.cron.getJobByName('daily-email-fetch');

      if (job) {
        // Trigger the job manually
        job.fireOnTick();

        return reply.code(200).send({
          success: true,
          message: 'Email fetch job triggered successfully',
        });
      } else {
        return reply.code(500).send({
          error: 'Email fetch job not found',
        });
      }
    } catch (error) {
      fastify.log.error({ err: error }, 'Error triggering email fetch');
      return reply.code(500).send({
        error: 'Failed to trigger email fetch',
      });
    }
  });

  // Add route to manually trigger email analysis (for testing)
  fastify.get('/admin/trigger-email-analysis', async (_request, reply) => {
    try {
      fastify.log.info('Manually triggering email analysis job');

      // Find and execute the job
      const job = fastify.cron.getJobByName('daily-email-analysis');

      if (job) {
        // Trigger the job manually
        job.fireOnTick();

        return reply.code(200).send({
          success: true,
          message: 'Email analysis job triggered successfully',
        });
      } else {
        return reply.code(500).send({
          error: 'Email analysis job not found',
        });
      }
    } catch (error) {
      fastify.log.error({ err: error }, 'Error triggering email analysis');
      return reply.code(500).send({
        error: 'Failed to trigger email analysis',
      });
    }
  });

  fastify.log.info(
    {
      schedule: process.env.CRON_SCHEDULE || '0 0 8 * * *',
      timezone: process.env.TZ || 'UTC',
    },
    'Daily summary cron job registered'
  );

  fastify.log.info(
    {
      schedule: '0 0 2 * * *',
      timezone: 'UTC',
    },
    'Session cleanup cron job registered'
  );

  fastify.log.info(
    {
      schedule: '0 */15 * * * *',
      timezone: 'UTC',
    },
    'Event sync retry cron job registered'
  );

  fastify.log.info(
    {
      schedule: process.env.EMAIL_FETCH_SCHEDULE || '0 0 6 * * *',
      timezone: process.env.TZ || 'UTC',
    },
    'Daily email fetch cron job registered'
  );

  fastify.log.info(
    {
      schedule: process.env.EMAIL_ANALYSIS_SCHEDULE || '0 0 7 * * *',
      timezone: process.env.TZ || 'UTC',
    },
    'Daily email analysis cron job registered'
  );
}

// Export as Fastify plugin
export default fp(dailySummaryPlugin, {
  name: 'daily-summary-plugin',
});
