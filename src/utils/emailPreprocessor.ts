// src/utils/emailPreprocessor.ts
import type { OAuth2Client } from 'google-auth-library';
import type { InboxAnalysisInput, EmailMetadata } from '../types/summary.js';
import { listTodos } from '../db/todoDb.js';
import { google } from 'googleapis';

/**
 * Fetch upcoming calendar events
 *
 * @param auth - OAuth2Client with Calendar access
 * @param daysAhead - Number of days to look ahead (default: 7)
 * @returns Array of upcoming events
 */
async function fetchUpcomingEvents(
  auth: OAuth2Client,
  daysAhead: number = 7
): Promise<Array<{ summary: string; start: string }>> {
  const calendar = google.calendar({ version: 'v3', auth });

  try {
    const now = new Date();
    const timeMin = now.toISOString();

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);
    const timeMax = futureDate.toISOString();

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      maxResults: 10,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];

    return events.map((event) => ({
      summary: event.summary || '(no title)',
      start: event.start?.dateTime || event.start?.date || '',
    }));
  } catch (error: any) {
    console.error('Failed to fetch calendar events:', error.message);
    return [];
  }
}

/**
 * Prepare emails, TODOs, and events for AI analysis
 *
 * @param userId - User ID
 * @param auth - OAuth2Client for calendar access
 * @param emails - Array of email metadata
 * @returns Formatted input for AI analysis
 */
export async function prepareEmailsForAI(
  userId: string,
  auth: OAuth2Client,
  emails: EmailMetadata[]
): Promise<InboxAnalysisInput> {
  // Get upcoming TODOs (pending only, due within 7 days)
  const allTodos = listTodos(userId);
  const now = new Date();
  const sevenDaysFromNow = new Date();
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

  const upcomingTodos = allTodos
    .filter((todo) => {
      if (todo.status !== 'pending') return false;
      if (!todo.due_date) return false;

      const dueDate = new Date(todo.due_date);
      return dueDate >= now && dueDate <= sevenDaysFromNow;
    })
    .map((todo) => ({
      description: todo.description,
      dueDate: todo.due_date ? new Date(todo.due_date).toISOString() : undefined,
    }));

  // Get upcoming calendar events
  const upcomingEvents = await fetchUpcomingEvents(auth, 7);

  // Format current date
  const date = new Date().toISOString().split('T')[0]!; // YYYY-MM-DD

  return {
    date,
    emailCount: emails.length,
    emails,
    upcomingTodos,
    upcomingEvents,
  };
}

/**
 * Truncate email snippet to avoid token bloat
 *
 * @param snippet - Email snippet
 * @param maxLength - Maximum length (default: 200)
 * @returns Truncated snippet
 */
export function truncateSnippet(snippet: string, maxLength: number = 200): string {
  if (snippet.length <= maxLength) {
    return snippet;
  }

  return snippet.substring(0, maxLength) + '...';
}

/**
 * Sanitize emails for AI processing
 * - Truncate long snippets
 * - Remove sensitive labels
 * - Clean up email addresses
 *
 * @param emails - Array of email metadata
 * @returns Sanitized emails
 */
export function sanitizeEmails(emails: EmailMetadata[]): EmailMetadata[] {
  return emails.map((email) => ({
    ...email,
    snippet: truncateSnippet(email.snippet),
    labels: email.labels.filter((label) => !label.startsWith('Label_')), // Remove custom labels
  }));
}
