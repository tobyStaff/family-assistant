// src/plugins/dailySummary.ts
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import fastifyCron from 'fastify-cron';
import { requireAdmin } from '../middleware/authorization.js';
import { generatePersonalizedSummary, type PersonalizedSummary, type ChildSummary, type FamilySummary } from '../utils/personalizedSummaryBuilder.js';
import { renderPersonalizedEmail, type PersonalizedSummaryWithActions, type TodoWithAction, type EventWithAction, type ChildSummaryWithActions, type FamilySummaryWithActions } from '../templates/personalizedEmailTemplate.js';
import { sendEmail, buildSesFromAddress, buildSummarySubject } from '../utils/emailSender.js';
import { getAllOAuthUserIds } from '../db/authDb.js';
import { getUser, getHostedEmailAlias, getAllUsersWithRoles } from '../db/userDb.js';
import { getAuth } from '../db/authDb.js';
import { decrypt } from '../lib/crypto.js';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { cleanupExpiredSessions } from '../db/sessionDb.js';
import { getEmailSource, getOrCreateDefaultSettings } from '../db/settingsDb.js';
import { fetchAndStoreEmails, syncProcessedLabels } from '../utils/emailStorageService.js';
import { analyzeUnanalyzedEmails } from '../parsers/twoPassAnalyzer.js';
import { getIncludedSenders, hasSenderFilters } from '../db/senderFilterDb.js';
import { createActionToken, createViewToken, cleanupExpiredTokens } from '../db/emailActionTokenDb.js';
import { cleanupPastItems } from '../utils/cleanupPastItems.js';
import { runOnboardingSequence } from '../utils/onboardingSequence.js';
import type { Todo } from '../types/todo.js';
import type { ExtractedEvent } from '../types/extraction.js';

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
 * Transform a todo to include action + detail URLs
 */
function addTodoAction(todo: Todo, userId: string, baseUrl: string, viewBase: string): TodoWithAction {
  const token = createActionToken(userId, 'complete_todo', todo.id);
  return {
    ...todo,
    actionUrl: `${baseUrl}/api/action/${token}`,
    detailUrl: `${viewBase}/todo/${todo.id}`,
  };
}

/**
 * Transform an event to include action + detail URLs
 */
function addEventAction(event: ExtractedEvent & { id?: number }, userId: string, baseUrl: string, viewBase: string): EventWithAction {
  if (event.id) {
    const token = createActionToken(userId, 'remove_event', event.id);
    return {
      ...event,
      actionUrl: `${baseUrl}/api/action/${token}`,
      detailUrl: `${viewBase}/event/${event.id}`,
    };
  }
  return { ...event };
}

/**
 * Transform a PersonalizedSummary to include action URLs (one-shot Done/Remove)
 * and a forwardable detail URL (per-summary view token) on every item.
 */
export function addActionsToSummary(
  summary: PersonalizedSummary,
  userId: string,
  baseUrl: string
): PersonalizedSummaryWithActions {
  // One view token per summary email. Same token gates every L2/L3 request
  // for the lifetime of the email (7 days). Forwardable.
  const viewToken = createViewToken(userId);
  const viewBase = `${baseUrl}/view/${viewToken}`;

  const byChildWithActions: ChildSummaryWithActions[] = summary.by_child.map(child => ({
    child_name: child.child_name,
    display_name: child.display_name,
    today_todos: child.today_todos.map(todo => addTodoAction(todo, userId, baseUrl, viewBase)),
    today_events: child.today_events.map(event => addEventAction(event, userId, baseUrl, viewBase)),
    upcoming_todos: child.upcoming_todos.map(todo => addTodoAction(todo, userId, baseUrl, viewBase)),
    upcoming_events: child.upcoming_events.map(event => addEventAction(event, userId, baseUrl, viewBase)),
    insights: child.insights,
  }));

  const familyWideWithActions: FamilySummaryWithActions = {
    today_todos: summary.family_wide.today_todos.map(todo => addTodoAction(todo, userId, baseUrl, viewBase)),
    today_events: summary.family_wide.today_events.map(event => addEventAction(event, userId, baseUrl, viewBase)),
    upcoming_todos: summary.family_wide.upcoming_todos.map(todo => addTodoAction(todo, userId, baseUrl, viewBase)),
    upcoming_events: summary.family_wide.upcoming_events.map(event => addEventAction(event, userId, baseUrl, viewBase)),
    insights: summary.family_wide.insights,
  };

  return {
    generated_at: summary.generated_at,
    date_range: summary.date_range,
    by_child: byChildWithActions,
    family_wide: familyWideWithActions,
    insights: summary.insights,
    highlight: summary.highlight,
    emailsAnalyzed: summary.emailsAnalyzed,
  };
}

/**
 * Process the daily summary for a single user.
 * Exported so admin routes can trigger it on demand with a custom hour.
 *
 * @param userId - User to process
 * @param currentHourUtc - UTC hour to compare against user's summary_time_utc setting
 * @param logger - Fastify-compatible logger
 */
export async function processUserSummary(
  userId: string,
  currentHourUtc: number,
  logger: { info: Function; debug: Function; error: Function }
): Promise<{ result: 'success' | 'skipped' | 'error'; reason?: string }> {
  const settings = getOrCreateDefaultSettings(userId);

  if (!settings.summary_enabled) {
    logger.info({ userId }, 'Skipping user - daily summary disabled');
    return { result: 'skipped', reason: 'summary disabled' };
  }

  const userSendHour = settings.summary_time_utc ?? 8;
  if (currentHourUtc !== userSendHour) {
    return { result: 'skipped', reason: 'hour mismatch' };
  }

  if (settings.summary_email_recipients.length === 0) {
    logger.info({ userId }, 'Skipping user - no email recipients configured');
    return { result: 'skipped', reason: 'no recipients' };
  }

  logger.info({ userId, userSendHour }, 'Processing daily summary for user');

  const cleanupResult = cleanupPastItems(userId);
  if (cleanupResult.todosCompleted > 0 || cleanupResult.eventsRemoved > 0) {
    logger.debug(
      { userId, todosCompleted: cleanupResult.todosCompleted, eventsRemoved: cleanupResult.eventsRemoved },
      'Cleaned up past items before summary'
    );
  }

  const summary = await generatePersonalizedSummary(userId, 7);
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const summaryWithActions = addActionsToSummary(summary, userId, baseUrl);
  const html = renderPersonalizedEmail(summaryWithActions);

  const totalTodos = summary.by_child.reduce((acc, child) =>
    acc + child.today_todos.length + child.upcoming_todos.length, 0
  ) + summary.family_wide.today_todos.length + summary.family_wide.upcoming_todos.length;

  const totalEvents = summary.by_child.reduce((acc, child) =>
    acc + child.today_events.length + child.upcoming_events.length, 0
  ) + summary.family_wide.today_events.length + summary.family_wide.upcoming_events.length;

  const alias = getHostedEmailAlias(userId);
  const fromAddress = buildSesFromAddress(alias);
  const subject = buildSummarySubject();
  await sendEmail(html, settings.summary_email_recipients, fromAddress, subject);

  logger.info(
    {
      userId,
      recipientCount: settings.summary_email_recipients.length,
      todoCount: totalTodos,
      eventCount: totalEvents,
      childCount: summary.by_child.length,
      fromAddress,
      via: process.env.EMAIL_PROVIDER || 'ses',
    },
    'Personalized summary sent successfully'
  );

  return { result: 'success' };
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
        // Cron schedule: Run every hour to check per-user send times
        // Format: second minute hour day-of-month month day-of-week
        cronTime: '0 0 * * * *',  // Every hour at :00

        // Job name for logging and manual triggering
        name: 'daily-summary',

        // Main cron job function
        onTick: async function () {
          const currentHourUtc = new Date().getUTCHours();
          fastify.log.info({ currentHourUtc }, 'Daily summary check running');

          const USER_TIMEOUT_MS = 30_000;

          try {
            const userIds = getAllUsersWithRoles().map(u => u.user_id);

            let successCount = 0;
            let errorCount = 0;
            let skippedCount = 0;

            for (const userId of userIds) {
              try {
                const timeoutPromise = new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error(`Timed out after ${USER_TIMEOUT_MS}ms`)), USER_TIMEOUT_MS)
                );
                const { result } = await Promise.race([processUserSummary(userId, currentHourUtc, fastify.log), timeoutPromise]);
                if (result === 'success') successCount++;
                else skippedCount++;
              } catch (userError) {
                errorCount++;
                fastify.log.error({ err: userError, userId }, 'Error processing daily summary for user');
              }
            }

            fastify.log.info(
              {
                currentHourUtc,
                total: userIds.length,
                success: successCount,
                skipped: skippedCount,
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
            const deletedSessions = cleanupExpiredSessions();

            // Delete all expired action tokens
            const deletedTokens = cleanupExpiredTokens();

            fastify.log.info(
              {
                deletedSessions,
                deletedTokens,
              },
              'Session and token cleanup completed successfully'
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
        // Cron schedule: Daily at 5:00 AM UTC (before daily summary at 6:00 AM)
        cronTime: process.env.EMAIL_FETCH_SCHEDULE || '0 0 5 * * *',

        // Job name for logging
        name: 'daily-email-fetch',

        // Main cron job function
        onTick: async function () {
          fastify.log.info('Starting daily email fetch cron job');

          try {
            // Get all users with stored auth
            const userIds = getAllOAuthUserIds();
            fastify.log.info(`Processing email fetch for ${userIds.length} users`);

            let totalFetched = 0;
            let totalStored = 0;
            let totalErrors = 0;

            // Process each user
            for (const userId of userIds) {
              try {
                // Skip users whose email source is not Gmail
                if (getEmailSource(userId) !== 'gmail') {
                  fastify.log.debug({ userId }, 'Skipping email fetch for non-Gmail user');
                  continue;
                }

                // Get user's OAuth2 client
                const auth = await getUserAuth(userId);

                // Build sender filter query if user has configured filters
                let senderQuery = '';
                if (hasSenderFilters(userId)) {
                  const includedSenders = getIncludedSenders(userId);
                  if (includedSenders.length > 0) {
                    senderQuery = `{${includedSenders.map(s => `from:${s}`).join(' OR ')}}`;
                  }
                }

                // Fetch and store unprocessed emails (last 3 days by default)
                const result = await fetchAndStoreEmails(userId, auth, 'last3days', 500, senderQuery);

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
        // Cron schedule: Daily at 5:30 AM UTC (after email fetch at 5:00 AM)
        cronTime: process.env.EMAIL_ANALYSIS_SCHEDULE || '0 30 5 * * *',

        // Job name for logging
        name: 'daily-email-analysis',

        // Main cron job function
        onTick: async function () {
          fastify.log.info('Starting daily email analysis cron job');

          try {
            const userIds = getAllUsersWithRoles().map(u => u.user_id);
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
            const { getAllOAuthUserIds } = await import('../db/authDb.js');
            const { syncPendingEventsForUser } = await import('../utils/eventSyncService.js');
            const { isCalendarConnected } = await import('../db/userDb.js');

            // Get all users with stored auth
            const userIds = getAllOAuthUserIds();
            let totalProcessed = 0;
            let totalSynced = 0;
            let totalFailed = 0;

            // Process each user
            for (const userId of userIds) {
              try {
                // Skip users who haven't connected Google Calendar
                if (!isCalendarConnected(userId)) {
                  continue;
                }

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
      {
        // Onboarding sequence emailer — sends Days 2-7 emails for trial users
        // Cron schedule: Daily at 8:00 AM UTC
        cronTime: '0 0 8 * * *',

        name: 'onboarding-sequence',

        onTick: async function () {
          try {
            await runOnboardingSequence(fastify.log);
          } catch (error) {
            fastify.log.error({ err: error }, 'Fatal error in onboarding sequence cron job');
          }
        },

        start: true,
        timeZone: 'UTC',
      },
    ],
  });

  // Add route to manually trigger daily summary (for testing)
  fastify.get('/admin/trigger-daily-summary', { preHandler: requireAdmin }, async (_request, reply) => {
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

  // Add route to manually trigger event sync (ADMIN only)
  fastify.get('/admin/trigger-event-sync', { preHandler: requireAdmin }, async (_request, reply) => {
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
  fastify.get('/admin/trigger-email-fetch', { preHandler: requireAdmin }, async (_request, reply) => {
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
  fastify.get('/admin/trigger-email-analysis', { preHandler: requireAdmin }, async (_request, reply) => {
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
      schedule: 'Every hour at :00 (checks per-user summary_time_utc setting)',
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
      schedule: process.env.EMAIL_FETCH_SCHEDULE || '0 0 5 * * *',
      timezone: process.env.TZ || 'UTC',
    },
    'Daily email fetch cron job registered'
  );

  fastify.log.info(
    {
      schedule: process.env.EMAIL_ANALYSIS_SCHEDULE || '0 30 5 * * *',
      timezone: process.env.TZ || 'UTC',
    },
    'Daily email analysis cron job registered'
  );
}

// Export as Fastify plugin
export default fp(dailySummaryPlugin, {
  name: 'daily-summary-plugin',
});
