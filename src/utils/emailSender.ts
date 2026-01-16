// src/utils/emailSender.ts
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { SchoolSummary } from '../types/summary.js';

/**
 * Format date for email display
 */
function formatDate(date: Date): string {
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Generate HTML email body for daily summary (legacy)
 */
function generateHtmlBody(summary: { todos: Array<{ description: string; dueDate?: Date }>; events: Array<{ summary: string; start: Date; end?: Date }> }): string {
  const todosList = summary.todos.length
    ? summary.todos
        .map(
          t =>
            `<li>${t.description}${t.dueDate ? ` <strong>(Due: ${formatDate(t.dueDate)})</strong>` : ''}</li>`
        )
        .join('')
    : '<li><em>No upcoming TODOs</em></li>';

  const eventsList = summary.events.length
    ? summary.events
        .map(
          e =>
            `<li>${e.summary} <strong>(${formatDate(e.start)}${e.end ? ` - ${formatDate(e.end)}` : ''})</strong></li>`
        )
        .join('')
    : '<li><em>No upcoming events</em></li>';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    h1 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; }
    h2 { color: #34495e; margin-top: 20px; }
    ul { list-style-type: none; padding: 0; }
    li { padding: 8px; margin: 4px 0; background: #f8f9fa; border-left: 3px solid #3498db; }
    em { color: #7f8c8d; }
    strong { color: #2980b9; }
  </style>
</head>
<body>
  <h1>📧 Daily Inbox Summary</h1>
  <p>Here's your summary for the next 24 hours:</p>

  <h2>✅ Upcoming TODOs</h2>
  <ul>
    ${todosList}
  </ul>

  <h2>📅 Upcoming Calendar Events</h2>
  <ul>
    ${eventsList}
  </ul>

  <hr>
  <p style="color: #7f8c8d; font-size: 0.9em;">
    This is an automated message from Inbox Manager.
  </p>
</body>
</html>
  `.trim();
}

/**
 * Generate plain text email body for daily summary (legacy)
 */
function generateTextBody(summary: { todos: Array<{ description: string; dueDate?: Date }>; events: Array<{ summary: string; start: Date; end?: Date }> }): string {
  const todosText = summary.todos.length
    ? summary.todos
        .map(t => `  - ${t.description}${t.dueDate ? ` (Due: ${formatDate(t.dueDate)})` : ''}`)
        .join('\n')
    : '  - No upcoming TODOs';

  const eventsText = summary.events.length
    ? summary.events
        .map(
          e =>
            `  - ${e.summary} (${formatDate(e.start)}${e.end ? ` - ${formatDate(e.end)}` : ''})`
        )
        .join('\n')
    : '  - No upcoming events';

  return `
Daily Inbox Summary
===================

Here's your summary for the next 24 hours:

Upcoming TODOs:
${todosText}

Upcoming Calendar Events:
${eventsText}

---
This is an automated message from Inbox Manager.
  `.trim();
}

/**
 * Create RFC 2822 email message
 */
function createEmailMessage(to: string, subject: string, html: string, text?: string): string {
  const boundary = 'inbox_manager_boundary_' + Date.now();

  // If no text version provided, create a simple text version
  const textBody = text || 'Please view this email in an HTML-enabled email client.';

  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    textBody,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    html,
    '',
    `--${boundary}--`,
  ].join('\r\n');

  return message;
}

/**
 * Send daily summary email via Gmail API (legacy - kept for compatibility)
 *
 * @param auth - OAuth2 client for the user
 * @param summary - Daily summary data
 * @param userEmail - User's email address
 */
export async function sendDailySummary(
  auth: OAuth2Client,
  summary: { todos: Array<{ description: string; dueDate?: Date }>; events: Array<{ summary: string; start: Date; end?: Date }> },
  userEmail: string
): Promise<void> {
  const gmail = google.gmail({ version: 'v1', auth });

  // Generate email bodies
  const html = generateHtmlBody(summary);
  const text = generateTextBody(summary);
  const message = createEmailMessage(userEmail, 'Daily Inbox Summary', html, text);

  // Encode message in base64url format (RFC 4648)
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

    console.log(`Daily summary sent to ${userEmail}`);
  } catch (error) {
    console.error(`Failed to send daily summary to ${userEmail}:`, error);
    throw error;
  }
}

/**
 * Send inbox summary email with AI-generated content
 *
 * This is the main function for sending the new AI-powered email summaries.
 * Sends to multiple recipients if specified.
 *
 * @param auth - OAuth2 client for the user (used for Gmail sending)
 * @param summary - AI-generated school summary
 * @param html - Rendered HTML email
 * @param recipients - Array of email addresses to send to
 * @returns Number of emails successfully sent
 */
export async function sendInboxSummary(
  auth: OAuth2Client,
  summary: SchoolSummary,
  html: string,
  recipients: string[]
): Promise<number> {
  const gmail = google.gmail({ version: 'v1', auth });

  // Generate subject line for school summary
  let subject = 'Daily Briefing';

  // Add date
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
  subject += ` (${today})`;

  let sentCount = 0;
  const errors: Array<{ recipient: string; error: string }> = [];

  // Send to each recipient
  for (const recipient of recipients) {
    try {
      const message = createEmailMessage(recipient, subject, html);

      // Encode message in base64url format (RFC 4648)
      const encoded = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encoded },
      });

      console.log(`Inbox summary sent to ${recipient}`);
      sentCount++;
    } catch (error: any) {
      console.error(`Failed to send inbox summary to ${recipient}:`, error);
      console.error('Full error details:', {
        code: error.code,
        message: error.message,
        response: error.response?.data,
        errors: error.errors,
      });

      // Check for permission errors
      if (error.code === 403 || error.message?.includes('insufficient permissions')) {
        // Get more specific error details
        let detailedError = 'Insufficient Gmail permissions. ';

        if (error.response?.data?.error?.message) {
          detailedError += error.response.data.error.message;
        } else if (error.errors && error.errors.length > 0) {
          detailedError += error.errors[0].message;
        } else {
          detailedError += 'Please re-authenticate to grant email sending permissions.';
        }

        errors.push({
          recipient,
          error: detailedError,
        });
      } else {
        errors.push({
          recipient,
          error: error.message || 'Unknown error',
        });
      }
    }
  }

  if (errors.length > 0) {
    console.error('Some emails failed to send:', errors);

    // If all emails failed with the same error, throw that error
    if (sentCount === 0 && errors.length > 0 && errors[0]) {
      throw new Error(errors[0].error);
    }
  }

  return sentCount;
}
