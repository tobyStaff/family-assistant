// src/routes/adminRoutes.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getUserId, getUserAuth } from '../lib/userContext.js';
import { requireAuth } from '../middleware/session.js';
import { fetchRecentEmails, fetchRecentEmailsWithBody } from '../utils/inboxFetcher.js';
import { prepareEmailsForAI, sanitizeEmails } from '../utils/emailPreprocessor.js';
import type { DateRange } from '../utils/inboxFetcher.js';
import { analyzeInbox, type AIProvider } from '../parsers/summaryParser.js';
import { renderSummaryEmail } from '../utils/emailRenderer.js';
import { generateInboxSummary } from '../utils/summaryQueries.js';
import { sendInboxSummary } from '../utils/emailSender.js';
import { getOrCreateDefaultSettings } from '../db/settingsDb.js';
import { saveSummary } from '../db/summaryDb.js';

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
  }>('/admin/test-fetch-emails', { preHandler: requireAuth }, async (request, reply) => {
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
  fastify.get('/admin/inbox-stats', { preHandler: requireAuth }, async (request, reply) => {
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
  }>('/admin/preview-email-summary', { preHandler: requireAuth }, async (request, reply) => {
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

      // Run AI analysis
      const aiSummary = await analyzeInbox(aiInput, provider);

      // Render HTML
      const html = renderSummaryEmail(aiSummary);

      fastify.log.info({ userId, emailCount: emails.length }, 'Email preview generated successfully');

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
  fastify.get('/admin/check-scopes', { preHandler: requireAuth }, async (request, reply) => {
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
   * Test Gmail send capability with detailed diagnostics
   */
  fastify.post('/admin/test-gmail-send', { preHandler: requireAuth }, async (request, reply) => {
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

      // Try to send a test email
      const gmail = google.gmail({ version: 'v1', auth });

      // Create a simple test message
      const message = [
        'To: ' + tokenInfo.email,
        'Subject: Gmail API Test',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'This is a test message from Inbox Manager to verify Gmail send capability.',
      ].join('\r\n');

      const encoded = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      try {
        await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw: encoded },
        });

        return reply.code(200).send({
          success: true,
          message: 'Successfully sent test email!',
          recipient: tokenInfo.email,
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
   * FOR DEVELOPMENT/TESTING - allows testing the complete flow
   */
  fastify.post<{
    Body: z.infer<typeof SendSummarySchema>;
  }>('/admin/send-daily-summary', { preHandler: requireAuth }, async (request, reply) => {
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

      const dateRange = (bodyResult.data.dateRange || 'yesterday') as DateRange;
      const maxResults = bodyResult.data.maxResults || 100;
      const provider = (bodyResult.data.aiProvider || 'openai') as AIProvider;

      fastify.log.info({ userId, dateRange, maxResults, provider }, 'Generating and sending daily summary');

      // Step 1: Generate complete inbox summary (fetch + AI + render)
      const result = await generateInboxSummary(userId, auth, dateRange, maxResults, provider);

      // Step 2: Determine recipients
      let recipients: string[];
      if (bodyResult.data.testRecipients && bodyResult.data.testRecipients.length > 0) {
        // Use test recipients if provided
        recipients = bodyResult.data.testRecipients;
        fastify.log.info({ recipients }, 'Using test recipients');
      } else {
        // Use settings recipients
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

      // Step 3: Send emails
      const sentCount = await sendInboxSummary(auth, result.summary, result.html, recipients);

      // Step 4: Save summary to database
      saveSummary({
        user_id: userId,
        summary_date: new Date(),
        inbox_count: result.emailCount,
        summary_json: JSON.stringify(result.summary),
        sent_at: new Date(),
      });

      fastify.log.info(
        {
          userId,
          emailCount: result.emailCount,
          recipients: recipients.length,
          sentCount,
        },
        'Daily summary sent successfully'
      );

      return reply.code(200).send({
        success: true,
        emailsSent: sentCount,
        recipients,
        summary: {
          childSummaries: result.summary.summary.length,
          kitTomorrow: result.summary.kit_list.tomorrow.length,
          kitUpcoming: result.summary.kit_list.upcoming.length,
          financials: result.summary.financials.length,
          calendarUpdates: result.summary.calendar_updates.length,
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
  }>('/admin/view-raw-emails', { preHandler: requireAuth }, async (request, reply) => {
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
  fastify.post('/admin/preview-personalized-summary', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const auth = await getUserAuth(request);

      fastify.log.info({ userId }, 'Generating personalized summary preview');

      // Import the new personalized summary functions
      const { generatePersonalizedSummary } = await import('../utils/personalizedSummaryBuilder.js');
      const { renderPersonalizedEmail } = await import('../templates/personalizedEmailTemplate.js');

      // Generate personalized summary (uses stored events/todos)
      const summary = await generatePersonalizedSummary(userId, auth, 7); // Look ahead 7 days

      // Render HTML
      const html = renderPersonalizedEmail(summary);

      fastify.log.info(
        {
          userId,
          childCount: summary.by_child.length,
          totalInsights: summary.insights.length,
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
  }>('/admin/raw-emails', { preHandler: requireAuth }, async (request, reply) => {
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
}
