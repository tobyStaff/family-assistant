// src/routes/adminRoutes.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getUserId, getUserAuth } from '../lib/userContext.js';
import { requireAdmin, requireSuperAdmin, isRequestUserSuperAdmin, getEffectiveUserId, isImpersonating, requireNoImpersonation } from '../middleware/authorization.js';
import { fetchRecentEmails, fetchRecentEmailsWithBody } from '../utils/inboxFetcher.js';
import { prepareEmailsForAI, sanitizeEmails } from '../utils/emailPreprocessor.js';
import type { DateRange } from '../utils/inboxFetcher.js';
import { analyzeInbox, type AIProvider } from '../parsers/summaryParser.js';
import { renderSummaryEmail } from '../utils/emailRenderer.js';
import { generateInboxSummary } from '../utils/summaryQueries.js';
import { sendInboxSummary } from '../utils/emailSender.js';
import { getOrCreateDefaultSettings } from '../db/settingsDb.js';
import { saveSummary } from '../db/summaryDb.js';
import { getAllUsersWithRoles, getUser, getUserWithRoles, resetUserData } from '../db/userDb.js';
import type { Role } from '../types/roles.js';
import { renderLayout } from '../templates/layout.js';
import { renderAdminContent, renderAdminScripts } from '../templates/adminContent.js';

/**
 * Zod schema for test endpoint
 */
const TestFetchSchema = z.object({
  dateRange: z.enum(['today', 'yesterday', 'last3days', 'last7days', 'last30days', 'last90days']).optional(),
  maxResults: z.number().int().min(1).max(100).optional(),
  runAiAnalysis: z.boolean().optional(),
  aiProvider: z.enum(['openai', 'anthropic']).optional(),
});

/**
 * Zod schema for send daily summary endpoint
 */
const SendSummarySchema = z.object({
  dateRange: z.enum(['today', 'yesterday', 'last3days', 'last7days', 'last30days', 'last90days']).optional(),
  maxResults: z.number().int().min(1).max(100).optional(),
  aiProvider: z.enum(['openai', 'anthropic']).optional(),
  testRecipients: z.array(z.string().email()).optional(),
});

/**
 * Register admin/testing routes
 *
 * @param fastify - Fastify instance
 */
export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /admin/test-fetch-emails
   * Test endpoint to fetch emails and preview AI input format
   * FOR DEVELOPMENT/TESTING ONLY
   */
  fastify.post<{
    Body: z.infer<typeof TestFetchSchema>;
  }>('/admin/test-fetch-emails', { preHandler: [requireAdmin, requireNoImpersonation] }, async (request, reply) => {
    // Validate body
    const bodyResult = TestFetchSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    try {
      const userId = getUserId(request);
      const auth = await getUserAuth(request);

      const dateRange = (bodyResult.data.dateRange || 'yesterday') as DateRange;
      const maxResults = bodyResult.data.maxResults || 20;

      fastify.log.info({ userId, dateRange, maxResults }, 'Fetching emails for test');

      // Fetch emails
      const emails = await fetchRecentEmails(auth, dateRange, maxResults);

      // Sanitize for display
      const sanitized = sanitizeEmails(emails);

      // Prepare for AI
      const aiInput = await prepareEmailsForAI(userId, auth, sanitized);

      // Run AI analysis if requested
      let aiSummary = undefined;
      if (bodyResult.data.runAiAnalysis) {
        const provider = (bodyResult.data.aiProvider || 'openai') as AIProvider;
        fastify.log.info({ userId, provider }, 'Running AI analysis');

        try {
          aiSummary = await analyzeInbox(aiInput, provider);
          fastify.log.info({ userId, provider }, 'AI analysis completed successfully');
        } catch (error: any) {
          fastify.log.error({ err: error, provider }, 'AI analysis failed');
          return reply.code(500).send({
            error: 'AI analysis failed',
            message: error.message,
          });
        }
      }

      fastify.log.info(
        {
          userId,
          emailCount: emails.length,
          todoCount: aiInput.upcomingTodos.length,
          eventCount: aiInput.upcomingEvents.length,
        },
        'Emails fetched successfully'
      );

      return reply.code(200).send({
        success: true,
        fetchedCount: emails.length,
        dateRange,
        preview: {
          emails: sanitized.slice(0, 5), // Show first 5 for preview
          upcomingTodos: aiInput.upcomingTodos,
          upcomingEvents: aiInput.upcomingEvents,
        },
        aiInputPreview: {
          date: aiInput.date,
          emailCount: aiInput.emailCount,
          // Don't send all emails in response (too large)
          totalTodos: aiInput.upcomingTodos.length,
          totalEvents: aiInput.upcomingEvents.length,
        },
        aiSummary, // Include AI summary if analysis was run
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error fetching emails');
      return reply.code(500).send({
        error: 'Failed to fetch emails',
        message: error.message,
      });
    }
  });

  /**
   * GET /admin/inbox-stats
   * Get quick stats about inbox
   */
  fastify.get('/admin/inbox-stats', { preHandler: [requireAdmin, requireNoImpersonation] }, async (request, reply) => {
    try {
      const auth = await getUserAuth(request);

      // Fetch recent emails
      const emails = await fetchRecentEmails(auth, 'yesterday', 100);

      // Calculate stats
      const stats = {
        totalFetched: emails.length,
        withAttachments: emails.filter((e) => e.hasAttachments).length,
        uniqueSenders: new Set(emails.map((e) => e.from)).size,
        labelDistribution: emails
          .flatMap((e) => e.labels)
          .reduce((acc, label) => {
            acc[label] = (acc[label] || 0) + 1;
            return acc;
          }, {} as Record<string, number>),
      };

      return reply.code(200).send({
        success: true,
        dateRange: 'yesterday',
        stats,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error getting inbox stats');
      return reply.code(500).send({
        error: 'Failed to get inbox stats',
        message: error.message,
      });
    }
  });

  /**
   * POST /admin/preview-email-summary
   * Preview the HTML rendering of email summary
   */
  fastify.post<{
    Body: z.infer<typeof TestFetchSchema>;
  }>('/admin/preview-email-summary', { preHandler: [requireAdmin, requireNoImpersonation] }, async (request, reply) => {
    // Validate body
    const bodyResult = TestFetchSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    try {
      const userId = getUserId(request);
      const auth = await getUserAuth(request);

      const dateRange = (bodyResult.data.dateRange || 'yesterday') as DateRange;
      const maxResults = bodyResult.data.maxResults || 20;
      const provider = (bodyResult.data.aiProvider || 'openai') as AIProvider;

      fastify.log.info({ userId, dateRange, maxResults, provider }, 'Generating email preview');

      // Fetch emails with full body and attachment content
      const emails = await fetchRecentEmailsWithBody(auth, dateRange, maxResults);

      if (emails.length === 0) {
        return reply.code(200).type('text/html').send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>No Emails</title>
            <style>
              body {
                font-family: -apple-system, sans-serif;
                padding: 40px;
                text-align: center;
                color: #666;
              }
            </style>
          </head>
          <body>
            <h1>No emails found</h1>
            <p>No unread emails found for the specified date range: ${dateRange}</p>
          </body>
          </html>
        `);
      }

      // Sanitize and prepare for AI
      const sanitized = sanitizeEmails(emails);
      const aiInput = await prepareEmailsForAI(userId, auth, sanitized);

      // Run AI analysis (same as production)
      const startTime = Date.now();
      const aiSummary = await analyzeInbox(aiInput, provider);
      const responseTimeMs = Date.now() - startTime;

      // Validate AI output (same as production)
      const { validateSchoolSummary, formatValidationErrors } = await import('../utils/summaryValidator.js');
      const { recordAIMetrics } = await import('../db/metricsDb.js');

      const validation = validateSchoolSummary(aiSummary, emails.length);

      if (!validation.valid) {
        fastify.log.error({ errors: validation.errors }, 'AI summary validation FAILED');

        // Record failed metrics (same as production)
        recordAIMetrics({
          user_id: userId,
          provider,
          emails_total: emails.length,
          emails_signal: aiSummary.email_analysis?.signal_count || 0,
          emails_noise: aiSummary.email_analysis?.noise_count || 0,
          validation_passed: false,
          validation_errors: JSON.stringify(validation.errors),
          response_time_ms: responseTimeMs,
          schema_validated: provider === 'openai',
        });

        throw new Error(
          `AI generated invalid summary with ${validation.errors.length} error(s): ${validation.errors[0]}`
        );
      }

      if (validation.warnings.length > 0) {
        fastify.log.warn({ warnings: validation.warnings }, 'AI summary has warnings');
      }

      // Record successful metrics (same as production)
      recordAIMetrics({
        user_id: userId,
        provider,
        emails_total: emails.length,
        emails_signal: aiSummary.email_analysis?.signal_count || 0,
        emails_noise: aiSummary.email_analysis?.noise_count || 0,
        validation_passed: true,
        validation_errors: validation.warnings.length > 0 ? JSON.stringify(validation.warnings) : undefined,
        response_time_ms: responseTimeMs,
        schema_validated: provider === 'openai',
      });

      // Render HTML
      const html = renderSummaryEmail(aiSummary);

      fastify.log.info({ userId, emailCount: emails.length, responseTimeMs }, 'Email preview generated successfully');

      // Return HTML for browser preview
      return reply.code(200).type('text/html').send(html);
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error generating email preview');
      return reply.code(500).type('text/html').send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Error</title>
          <style>
            body {
              font-family: -apple-system, sans-serif;
              padding: 40px;
              color: #d32f2f;
            }
            pre {
              background: #f5f5f5;
              padding: 15px;
              border-radius: 4px;
              overflow-x: auto;
            }
          </style>
        </head>
        <body>
          <h1>Error generating preview</h1>
          <p>${error.message}</p>
          <pre>${error.stack || ''}</pre>
        </body>
        </html>
      `);
    }
  });

  /**
   * GET /admin/check-scopes
   * Check what OAuth scopes the current token has
   */
  fastify.get('/admin/check-scopes', { preHandler: [requireAdmin, requireNoImpersonation] }, async (request, reply) => {
    try {
      const auth = await getUserAuth(request);
      const tokenInfo = await auth.getTokenInfo(auth.credentials.access_token!);

      return reply.code(200).send({
        scopes: tokenInfo.scopes,
        hasGmailSend: tokenInfo.scopes?.includes('https://www.googleapis.com/auth/gmail.send'),
        hasGmailReadonly: tokenInfo.scopes?.includes('https://www.googleapis.com/auth/gmail.readonly'),
        email: tokenInfo.email,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error checking scopes');
      return reply.code(500).send({
        error: 'Failed to check scopes',
        message: error.message,
      });
    }
  });

  /**
   * POST /admin/test-gmail-send
   * Test Gmail send capability using the same code path as production
   */
  fastify.post('/admin/test-gmail-send', { preHandler: [requireAdmin, requireNoImpersonation] }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const auth = await getUserAuth(request);
      const { google } = await import('googleapis');

      fastify.log.info({ userId }, 'Testing Gmail send capability');

      // Check token info first
      const tokenInfo = await auth.getTokenInfo(auth.credentials.access_token!);
      const hasGmailSend = tokenInfo.scopes?.includes('https://www.googleapis.com/auth/gmail.send');

      if (!hasGmailSend) {
        return reply.code(200).send({
          success: false,
          issue: 'missing_scope',
          message: 'Token does not have gmail.send scope',
          scopes: tokenInfo.scopes,
        });
      }

      // Create a test HTML email (same format as production emails)
      const testHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, sans-serif; padding: 20px; }
          </style>
        </head>
        <body>
          <h1>📧 Gmail API Test</h1>
          <p>This is a test message from Inbox Manager to verify Gmail send capability.</p>
          <p>If you received this email, the Gmail API is working correctly.</p>
          <hr>
          <p style="color: #666; font-size: 0.9em;">Sent at: ${new Date().toISOString()}</p>
        </body>
        </html>
      `;

      // Use the same sendInboxSummary function as production
      // This tests the full email sending code path including MIME encoding
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

      try {
        const sentCount = await sendInboxSummary(auth, dummySummary, testHtml, [tokenInfo.email!]);

        return reply.code(200).send({
          success: true,
          message: 'Successfully sent test email using production code path!',
          recipient: tokenInfo.email,
          sentCount,
        });
      } catch (sendError: any) {
        fastify.log.error({ err: sendError }, 'Gmail send failed');

        return reply.code(200).send({
          success: false,
          issue: 'api_error',
          errorCode: sendError.code,
          errorMessage: sendError.message,
          errorDetails: sendError.response?.data?.error,
          possibleCauses: [
            sendError.code === 403 ? 'Gmail API may not be enabled in Google Cloud Console' : null,
            sendError.code === 403 ? 'App may be in testing mode with restricted users' : null,
            sendError.code === 401 ? 'Token may be expired or invalid' : null,
            sendError.code === 429 ? 'Rate limit exceeded' : null,
          ].filter(Boolean),
        });
      }
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error testing Gmail send');
      return reply.code(500).send({
        error: 'Failed to test Gmail send',
        message: error.message,
      });
    }
  });

  /**
   * POST /admin/send-daily-summary
   * Manually trigger sending of daily summary email
   * FOR DEVELOPMENT/TESTING - follows exact same code path as production cron job
   */
  fastify.post<{
    Body: z.infer<typeof SendSummarySchema>;
  }>('/admin/send-daily-summary', { preHandler: requireAdmin }, async (request, reply) => {
    // Validate body
    const bodyResult = SendSummarySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    try {
      const userId = getUserId(request);
      const auth = await getUserAuth(request);

      fastify.log.info({ userId }, 'Generating and sending personalized daily summary');

      // Import functions (same as production cron job)
      const { generatePersonalizedSummary } = await import('../utils/personalizedSummaryBuilder.js');
      const { renderPersonalizedEmail } = await import('../templates/personalizedEmailTemplate.js');
      const { cleanupPastItems } = await import('../utils/cleanupPastItems.js');
      const { createActionToken } = await import('../db/emailActionTokenDb.js');

      // Step 1: Clean up past items (same as production)
      const cleanupResult = cleanupPastItems(userId);
      if (cleanupResult.todosCompleted > 0 || cleanupResult.eventsRemoved > 0) {
        fastify.log.info(
          { userId, todosCompleted: cleanupResult.todosCompleted, eventsRemoved: cleanupResult.eventsRemoved },
          'Cleaned up past items before summary'
        );
      }

      // Step 2: Generate personalized summary (same as production)
      const summary = await generatePersonalizedSummary(userId, 7);

      // Step 3: Add action URLs (same as production)
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

      // Helper to add action URL to todo
      const addTodoAction = (todo: any) => {
        const token = createActionToken(userId, 'complete_todo', todo.id);
        return { ...todo, actionUrl: `${baseUrl}/api/action/${token}` };
      };

      // Helper to add action URL to event
      const addEventAction = (event: any) => {
        if (event.id) {
          const token = createActionToken(userId, 'remove_event', event.id);
          return { ...event, actionUrl: `${baseUrl}/api/action/${token}` };
        }
        return { ...event };
      };

      // Transform summary with action URLs
      const summaryWithActions = {
        generated_at: summary.generated_at,
        date_range: summary.date_range,
        by_child: summary.by_child.map(child => ({
          child_name: child.child_name,
          display_name: child.display_name,
          today_todos: child.today_todos.map(addTodoAction),
          today_events: child.today_events.map(addEventAction),
          upcoming_todos: child.upcoming_todos.map(addTodoAction),
          upcoming_events: child.upcoming_events.map(addEventAction),
          insights: child.insights,
        })),
        family_wide: {
          today_todos: summary.family_wide.today_todos.map(addTodoAction),
          today_events: summary.family_wide.today_events.map(addEventAction),
          upcoming_todos: summary.family_wide.upcoming_todos.map(addTodoAction),
          upcoming_events: summary.family_wide.upcoming_events.map(addEventAction),
          insights: summary.family_wide.insights,
        },
        insights: summary.insights,
        highlight: summary.highlight,
        emailsAnalyzed: summary.emailsAnalyzed,
      };

      // Step 4: Render HTML (same as production)
      const html = renderPersonalizedEmail(summaryWithActions);

      // Step 5: Determine recipients
      let recipients: string[];
      if (bodyResult.data.testRecipients && bodyResult.data.testRecipients.length > 0) {
        recipients = bodyResult.data.testRecipients;
        fastify.log.info({ recipients }, 'Using test recipients');
      } else {
        const settings = getOrCreateDefaultSettings(userId);
        if (!settings.summary_enabled) {
          return reply.code(400).send({
            error: 'Summary sending is disabled',
            message: 'Enable summary sending in settings or provide testRecipients',
          });
        }
        recipients = settings.summary_email_recipients;
      }

      if (recipients.length === 0) {
        return reply.code(400).send({
          error: 'No recipients specified',
          message: 'Configure recipients in settings or provide testRecipients',
        });
      }

      // Count items (same as production)
      const totalTodos = summary.by_child.reduce((acc, child) =>
        acc + child.today_todos.length + child.upcoming_todos.length, 0
      ) + summary.family_wide.today_todos.length + summary.family_wide.upcoming_todos.length;

      const totalEvents = summary.by_child.reduce((acc, child) =>
        acc + child.today_events.length + child.upcoming_events.length, 0
      ) + summary.family_wide.today_events.length + summary.family_wide.upcoming_events.length;

      // Step 6: Send email (same as production - uses dummy summary for legacy compatibility)
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

      const sentCount = await sendInboxSummary(auth, dummySummary, html, recipients);

      // Step 7: Save summary to database
      saveSummary({
        user_id: userId,
        summary_date: new Date(),
        inbox_count: totalTodos + totalEvents,
        summary_json: JSON.stringify(summary),
        sent_at: new Date(),
      });

      fastify.log.info(
        {
          userId,
          todoCount: totalTodos,
          eventCount: totalEvents,
          childCount: summary.by_child.length,
          recipients: recipients.length,
          sentCount,
        },
        'Personalized daily summary sent successfully'
      );

      return reply.code(200).send({
        success: true,
        emailsSent: sentCount,
        recipients,
        summary: {
          childCount: summary.by_child.length,
          totalTodos,
          totalEvents,
          todayTodos: summary.by_child.reduce((acc, c) => acc + c.today_todos.length, 0) + summary.family_wide.today_todos.length,
          todayEvents: summary.by_child.reduce((acc, c) => acc + c.today_events.length, 0) + summary.family_wide.today_events.length,
          insights: summary.insights.length,
        },
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error sending daily summary');
      return reply.code(500).send({
        error: 'Failed to send daily summary',
        message: error.message,
      });
    }
  });

  /**
   * POST /admin/view-raw-emails
   * Fetch raw emails and return as readable text for debugging
   */
  fastify.post<{
    Body: z.infer<typeof SendSummarySchema>;
  }>('/admin/view-raw-emails', { preHandler: [requireAdmin, requireNoImpersonation] }, async (request, reply) => {
    // Validate body
    const bodyResult = SendSummarySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    try {
      const auth = await getUserAuth(request);
      const dateRange = (bodyResult.data.dateRange || 'yesterday') as DateRange;
      const maxResults = bodyResult.data.maxResults || 100;

      // Fetch emails with full body content
      const emails = await fetchRecentEmailsWithBody(auth, dateRange, maxResults);

      // Format date range description
      let rangeDescription = '';
      switch (dateRange) {
        case 'today':
          rangeDescription = 'today';
          break;
        case 'yesterday':
          rangeDescription = 'yesterday';
          break;
        case 'last3days':
          rangeDescription = 'the last 3 days';
          break;
        case 'last7days':
          rangeDescription = 'the last 7 days';
          break;
        case 'last30days':
          rangeDescription = 'the last 30 days';
          break;
        case 'last90days':
          rangeDescription = 'the last 3 months';
          break;
      }

      // Format as readable text
      const lines = [
        `[${emails.length}] emails processed from ${rangeDescription}`,
        ``,
        `=================================================`,
        `RAW EMAIL DUMP`,
        `=================================================`,
        `Date Range: ${dateRange}`,
        `Total Emails: ${emails.length}`,
        `Max Results: ${maxResults}`,
        `=================================================`,
        ``,
      ];

      emails.forEach((email, index) => {
        lines.push(`EMAIL ${index + 1} of ${emails.length}`);
        lines.push(`---`);
        lines.push(`From: ${email.fromName} <${email.from}>`);
        lines.push(`Subject: ${email.subject}`);
        lines.push(`Date: ${email.receivedAt}`);
        lines.push(`Labels: ${email.labels.join(', ')}`);
        lines.push(`Has Attachments: ${email.hasAttachments ? 'Yes' : 'No'}`);
        lines.push(``);
        lines.push(`BODY:`);
        lines.push(email.body);
        lines.push(``);
        lines.push(`---`);
        lines.push(``);
      });

      lines.push(`=================================================`);
      lines.push(`END OF EMAIL DUMP`);
      lines.push(`=================================================`);

      const textContent = lines.join('\n');

      // Return as plain text
      return reply
        .type('text/plain')
        .send(textContent);
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error fetching raw emails');
      return reply.code(500).send({
        error: 'Failed to fetch emails',
        message: error.message,
      });
    }
  });

  /**
   * POST /admin/preview-personalized-summary
   * Preview the new personalized summary (Phase 4 - uses stored events/todos)
   */
  fastify.post('/admin/preview-personalized-summary', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const auth = await getUserAuth(request);

      fastify.log.info({ userId }, 'Generating personalized summary preview');

      // Import the new personalized summary functions (same as production)
      const { generatePersonalizedSummary } = await import('../utils/personalizedSummaryBuilder.js');
      const { renderPersonalizedEmail } = await import('../templates/personalizedEmailTemplate.js');
      const { cleanupPastItems } = await import('../utils/cleanupPastItems.js');
      const { createActionToken } = await import('../db/emailActionTokenDb.js');

      // Clean up past items before generating summary (same as production)
      const cleanupResult = cleanupPastItems(userId);
      if (cleanupResult.todosCompleted > 0 || cleanupResult.eventsRemoved > 0) {
        fastify.log.info(
          { userId, todosCompleted: cleanupResult.todosCompleted, eventsRemoved: cleanupResult.eventsRemoved },
          'Cleaned up past items before preview'
        );
      }

      // Generate personalized summary (uses stored events/todos from database)
      const summary = await generatePersonalizedSummary(userId, 7); // Look ahead 7 days

      // Add action URLs (same as production)
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

      const addTodoAction = (todo: any) => {
        const token = createActionToken(userId, 'complete_todo', todo.id);
        return { ...todo, actionUrl: `${baseUrl}/api/action/${token}` };
      };

      const addEventAction = (event: any) => {
        if (event.id) {
          const token = createActionToken(userId, 'remove_event', event.id);
          return { ...event, actionUrl: `${baseUrl}/api/action/${token}` };
        }
        return { ...event };
      };

      const summaryWithActions = {
        generated_at: summary.generated_at,
        date_range: summary.date_range,
        by_child: summary.by_child.map(child => ({
          child_name: child.child_name,
          display_name: child.display_name,
          today_todos: child.today_todos.map(addTodoAction),
          today_events: child.today_events.map(addEventAction),
          upcoming_todos: child.upcoming_todos.map(addTodoAction),
          upcoming_events: child.upcoming_events.map(addEventAction),
          insights: child.insights,
        })),
        family_wide: {
          today_todos: summary.family_wide.today_todos.map(addTodoAction),
          today_events: summary.family_wide.today_events.map(addEventAction),
          upcoming_todos: summary.family_wide.upcoming_todos.map(addTodoAction),
          upcoming_events: summary.family_wide.upcoming_events.map(addEventAction),
          insights: summary.family_wide.insights,
        },
        insights: summary.insights,
        highlight: summary.highlight,
        emailsAnalyzed: summary.emailsAnalyzed,
      };

      // Render HTML (same as production)
      const html = renderPersonalizedEmail(summaryWithActions);

      fastify.log.info(
        {
          userId,
          childCount: summary.by_child.length,
          totalInsights: summary.insights.length,
          highlight: summary.highlight,
        },
        'Personalized summary preview generated'
      );

      // Return HTML for browser preview
      return reply.code(200).type('text/html').send(html);
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error generating personalized summary preview');
      return reply.code(500).type('text/html').send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Error</title>
          <style>
            body {
              font-family: -apple-system, sans-serif;
              padding: 40px;
              color: #d32f2f;
            }
            pre {
              background: #f5f5f5;
              padding: 15px;
              border-radius: 4px;
              overflow-x: auto;
            }
          </style>
        </head>
        <body>
          <h1>Error generating personalized summary</h1>
          <p>${error.message}</p>
          <pre>${error.stack || ''}</pre>
        </body>
        </html>
      `);
    }
  });

  /**
   * POST /admin/raw-emails
   * Fetch raw emails without AI processing
   */
  fastify.post<{
    Body: {
      dateRange?: string;
      maxResults?: number;
    };
  }>('/admin/raw-emails', { preHandler: [requireAdmin, requireNoImpersonation] }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const auth = await getUserAuth(request);

      const dateRange = (request.body.dateRange || 'last3days') as DateRange;
      const maxResults = request.body.maxResults || 20;

      fastify.log.info({ userId, dateRange, maxResults }, 'Fetching raw emails');

      // Fetch emails with full body text
      const emails = await fetchRecentEmailsWithBody(auth, dateRange, maxResults);

      fastify.log.info({ userId, count: emails.length }, 'Raw emails fetched successfully');

      return reply.code(200).send({
        success: true,
        emails: emails.map(email => ({
          id: email.id,
          subject: email.subject,
          from: email.from,
          date: email.receivedAt,
          bodyText: email.body,
          labels: email.labels,
          hasAttachments: email.hasAttachments,
        })),
        count: emails.length,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error fetching raw emails');
      return reply.code(500).send({
        success: false,
        error: error.message || 'Failed to fetch emails',
      });
    }
  });

  // ============================================
  // ADMIN DASHBOARD & USER MANAGEMENT
  // ============================================

  /**
   * GET /admin
   * Admin dashboard - shows admin tools and user list (for super admin)
   */
  fastify.get('/admin', { preHandler: requireAdmin }, async (request, reply) => {
    const userId = (request as any).userId;
    const userRoles = (request as any).userRoles as Role[];
    const user = getUser(userId);
    const isSuperAdmin = userRoles.includes('SUPER_ADMIN');
    const impersonatingUserId = (request as any).impersonatingUserId;

    // Get all users for super admin dropdown
    const allUsers = isSuperAdmin ? getAllUsersWithRoles() : [];

    // Get impersonated user info if active
    let impersonatedUser = null;
    if (impersonatingUserId) {
      impersonatedUser = getUser(impersonatingUserId);
    }

    // Generate content
    const content = renderAdminContent({
      userEmail: user?.email || 'Unknown',
      userRoles,
      isSuperAdmin,
      impersonatedUser: impersonatedUser ? { email: impersonatedUser.email } : null,
      allUsers,
      impersonatingUserId,
    });

    const scripts = renderAdminScripts();

    // Render with layout
    const html = renderLayout({
      title: 'Admin Dashboard',
      currentPath: '/admin',
      user: {
        name: user?.name,
        email: user?.email || 'Unknown',
        picture_url: user?.picture_url,
      },
      userRoles,
      impersonating: impersonatedUser ? {
        email: impersonatedUser.email,
        name: impersonatedUser.name,
      } : null,
      content,
      scripts,
    });

    return reply.type('text/html').send(html);
  });

  /**
   * POST /admin/impersonate
   * Start impersonating another user (SUPER_ADMIN only)
   */
  fastify.post<{
    Body: { targetUserId: string };
  }>('/admin/impersonate', { preHandler: requireSuperAdmin }, async (request, reply) => {
    const targetUserId = request.body?.targetUserId;

    if (!targetUserId) {
      return reply.code(400).send({
        error: 'Missing targetUserId',
      });
    }

    // Verify target user exists
    const targetUser = getUser(targetUserId);
    if (!targetUser) {
      return reply.code(404).send({
        error: 'User not found',
      });
    }

    // Set impersonation cookie
    reply.setCookie('impersonate_user_id', targetUserId, {
      path: '/',
      signed: true,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60, // 1 hour
    });

    fastify.log.info(
      { adminUserId: (request as any).userId, targetUserId, targetEmail: targetUser.email },
      'Super admin started impersonation'
    );

    return reply.redirect('/admin');
  });

  /**
   * POST /admin/stop-impersonation
   * Stop impersonating and return to own account
   */
  fastify.post('/admin/stop-impersonation', { preHandler: requireSuperAdmin }, async (request, reply) => {
    // Clear impersonation cookie
    reply.clearCookie('impersonate_user_id', { path: '/' });

    fastify.log.info(
      { adminUserId: (request as any).userId },
      'Super admin stopped impersonation'
    );

    return reply.redirect('/admin');
  });

  /**
   * GET /admin/users
   * Get all users (SUPER_ADMIN only, JSON API)
   */
  fastify.get('/admin/users', { preHandler: requireSuperAdmin }, async (request, reply) => {
    const users = getAllUsersWithRoles();

    return reply.code(200).send({
      success: true,
      users: users.map(u => ({
        user_id: u.user_id,
        email: u.email,
        name: u.name,
        roles: u.roles,
        created_at: u.created_at,
      })),
      count: users.length,
    });
  });

  // ============================================
  // ATTACHMENT RETRY ENDPOINTS
  // ============================================

  /**
   * GET /admin/failed-attachments
   * List all attachments with failed extraction
   */
  fastify.get('/admin/failed-attachments', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { getFailedAttachments } = await import('../db/attachmentDb.js');

      // Get effective user ID (handles impersonation)
      const effectiveUserId = getEffectiveUserId(request);
      const isSuperAdmin = isRequestUserSuperAdmin(request);

      // Super admins can see all failed attachments, others only see their own
      const failedAttachments = isSuperAdmin
        ? getFailedAttachments()
        : getFailedAttachments(effectiveUserId);

      return reply.code(200).send({
        success: true,
        attachments: failedAttachments.map(a => ({
          id: a.id,
          email_id: a.email_id,
          filename: a.filename,
          mime_type: a.mime_type,
          size: a.size,
          extraction_status: a.extraction_status,
          extraction_error: a.extraction_error,
          created_at: a.created_at,
          user_id: a.user_id,
          subject: a.subject,
          from_email: a.from_email,
        })),
        count: failedAttachments.length,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error fetching failed attachments');
      return reply.code(500).send({
        error: 'Failed to fetch failed attachments',
        message: error.message,
      });
    }
  });

  /**
   * POST /admin/attachments/:id/retry
   * Retry extraction for a single attachment
   */
  fastify.post<{
    Params: { id: string };
  }>('/admin/attachments/:id/retry', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const attachmentId = parseInt(request.params.id, 10);
      if (isNaN(attachmentId)) {
        return reply.code(400).send({ error: 'Invalid attachment ID' });
      }

      const { retryExtraction, rebuildAttachmentContent } = await import('../utils/attachmentExtractor.js');
      const { getAttachmentById } = await import('../db/attachmentDb.js');
      const { getEmailById } = await import('../db/emailDb.js');

      // Get attachment to find email
      const attachment = getAttachmentById(attachmentId);
      if (!attachment) {
        return reply.code(404).send({ error: 'Attachment not found' });
      }

      // Retry extraction
      const result = await retryExtraction(attachmentId);

      if (result.success) {
        // Rebuild and update email's attachment_content
        const { default: db } = await import('../db/db.js');
        const newContent = rebuildAttachmentContent(attachment.email_id);

        // Get email to update body_text
        const email = getEmailById('', attachment.email_id); // User ID not needed for this query pattern

        // Update email with new attachment content
        db.prepare(`
          UPDATE emails
          SET attachment_content = ?,
              attachment_extraction_failed = 0,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(newContent, attachment.email_id);

        fastify.log.info(
          { attachmentId, filename: attachment.filename },
          'Attachment extraction retry succeeded'
        );
      }

      return reply.code(200).send({
        success: result.success,
        attachmentId,
        filename: attachment.filename,
        extractedText: result.extractedText?.substring(0, 500), // Truncate for response
        error: result.error,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error retrying attachment extraction');
      return reply.code(500).send({
        error: 'Failed to retry extraction',
        message: error.message,
      });
    }
  });

  /**
   * POST /admin/emails/:id/retry-attachments
   * Retry extraction for all failed attachments in an email
   */
  fastify.post<{
    Params: { id: string };
  }>('/admin/emails/:id/retry-attachments', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const emailId = parseInt(request.params.id, 10);
      if (isNaN(emailId)) {
        return reply.code(400).send({ error: 'Invalid email ID' });
      }

      const { retryExtraction, rebuildAttachmentContent } = await import('../utils/attachmentExtractor.js');
      const { getAttachmentsByEmailId } = await import('../db/attachmentDb.js');

      // Get all failed attachments for this email
      const attachments = getAttachmentsByEmailId(emailId);
      const failedAttachments = attachments.filter(a => a.extraction_status === 'failed');

      if (failedAttachments.length === 0) {
        return reply.code(200).send({
          success: true,
          message: 'No failed attachments to retry',
          retried: 0,
          succeeded: 0,
        });
      }

      // Retry each failed attachment
      const results = await Promise.all(
        failedAttachments.map(async (attachment) => {
          const result = await retryExtraction(attachment.id);
          return {
            id: attachment.id,
            filename: attachment.filename,
            success: result.success,
            error: result.error,
          };
        })
      );

      const succeeded = results.filter(r => r.success).length;

      // Rebuild email's attachment_content if any succeeded
      if (succeeded > 0) {
        const { default: db } = await import('../db/db.js');
        const newContent = rebuildAttachmentContent(emailId);

        // Check if any attachments still failed
        const updatedAttachments = getAttachmentsByEmailId(emailId);
        const stillFailed = updatedAttachments.some(a => a.extraction_status === 'failed');

        db.prepare(`
          UPDATE emails
          SET attachment_content = ?,
              attachment_extraction_failed = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(newContent, stillFailed ? 1 : 0, emailId);
      }

      fastify.log.info(
        { emailId, retried: failedAttachments.length, succeeded },
        'Email attachment retry completed'
      );

      return reply.code(200).send({
        success: true,
        retried: failedAttachments.length,
        succeeded,
        results,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error retrying email attachments');
      return reply.code(500).send({
        error: 'Failed to retry attachments',
        message: error.message,
      });
    }
  });

  /**
   * POST /admin/emails/:id/reextract-attachments
   * Re-extract ALL attachments for an email (uses new AI Vision fallback)
   * This forces re-extraction regardless of current status
   */
  fastify.post<{
    Params: { id: string };
  }>('/admin/emails/:id/reextract-attachments', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const emailId = parseInt(request.params.id, 10);
      if (isNaN(emailId)) {
        return reply.code(400).send({ error: 'Invalid email ID' });
      }

      const { retryExtraction, rebuildAttachmentContent } = await import('../utils/attachmentExtractor.js');
      const { getAttachmentsByEmailId } = await import('../db/attachmentDb.js');

      // Get ALL attachments for this email (not just failed)
      const attachments = getAttachmentsByEmailId(emailId);

      if (attachments.length === 0) {
        return reply.code(200).send({
          success: true,
          message: 'No attachments found for this email',
          retried: 0,
          succeeded: 0,
        });
      }

      // Re-extract each attachment (uses new vision fallback logic)
      const results = await Promise.all(
        attachments.map(async (attachment) => {
          const result = await retryExtraction(attachment.id);
          return {
            id: attachment.id,
            filename: attachment.filename,
            mimeType: attachment.mime_type,
            success: result.success,
            extractedText: result.extractedText?.substring(0, 200), // Preview
            error: result.error,
          };
        })
      );

      const succeeded = results.filter(r => r.success).length;

      // Rebuild email's attachment_content
      const { default: db } = await import('../db/db.js');
      const newContent = rebuildAttachmentContent(emailId);

      // Check if any attachments still failed
      const updatedAttachments = getAttachmentsByEmailId(emailId);
      const stillFailed = updatedAttachments.some(a => a.extraction_status === 'failed');

      // Also update body_text - strip old attachment content and append new
      // body_text = original email body + attachment content (combined)
      const ATTACHMENT_MARKER = '\n\n=== IMPORTANT: ATTACHMENT CONTENT BELOW ===';
      const email = db.prepare('SELECT body_text FROM emails WHERE id = ?').get(emailId) as { body_text: string } | undefined;

      let newBodyText = email?.body_text || '';
      // Remove old attachment content if present
      const markerIndex = newBodyText.indexOf(ATTACHMENT_MARKER);
      if (markerIndex !== -1) {
        newBodyText = newBodyText.substring(0, markerIndex);
      }
      // Append new attachment content
      if (newContent) {
        newBodyText += newContent;
      }

      db.prepare(`
        UPDATE emails
        SET attachment_content = ?,
            attachment_extraction_failed = ?,
            body_text = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newContent, stillFailed ? 1 : 0, newBodyText, emailId);

      fastify.log.info(
        { emailId, total: attachments.length, succeeded },
        'Email attachment re-extraction completed'
      );

      return reply.code(200).send({
        success: true,
        message: `Re-extracted ${succeeded}/${attachments.length} attachments`,
        total: attachments.length,
        succeeded,
        results,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error re-extracting email attachments');
      return reply.code(500).send({
        error: 'Failed to re-extract attachments',
        message: error.message,
      });
    }
  });

  // ============================================
  // USER RESET (SUPER_ADMIN ONLY)
  // ============================================

  /**
   * POST /admin/reset-user/:userId
   * Reset a user's account to initial state (SUPER_ADMIN only)
   * Deletes all data but preserves the user account and session
   */
  fastify.post<{
    Params: { userId: string };
  }>('/admin/reset-user/:userId', { preHandler: requireSuperAdmin }, async (request, reply) => {
    try {
      const targetUserId = request.params.userId;

      // Verify target user exists
      const targetUser = getUser(targetUserId);
      if (!targetUser) {
        return reply.code(404).send({ error: 'User not found' });
      }

      fastify.log.info(
        { adminUserId: (request as any).userId, targetUserId, targetEmail: targetUser.email },
        'Super admin resetting user data'
      );

      const summary = resetUserData(targetUserId);

      const totalDeleted = Object.values(summary).reduce((a, b) => a + b, 0);

      fastify.log.info(
        { targetUserId, targetEmail: targetUser.email, summary, totalDeleted },
        'User data reset complete'
      );

      return reply.code(200).send({
        success: true,
        message: `Reset ${targetUser.email} — ${totalDeleted} records deleted`,
        summary,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error resetting user data');
      return reply.code(500).send({
        error: 'Failed to reset user',
        message: error.message,
      });
    }
  });
}
