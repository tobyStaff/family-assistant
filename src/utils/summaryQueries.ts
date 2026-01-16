// src/utils/summaryQueries.ts
import db from '../db/db.js';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { addHours } from 'date-fns';
import type { SchoolSummary } from '../types/summary.js';
import { fetchRecentEmailsWithBody } from './inboxFetcher.js';
import { prepareEmailsForAI, sanitizeEmails } from './emailPreprocessor.js';
import { analyzeInbox, type AIProvider } from '../parsers/summaryParser.js';
import { renderSummaryEmail } from './emailRenderer.js';
import type { DateRange } from './inboxFetcher.js';
import { validateSchoolSummary, formatValidationErrors } from './summaryValidator.js';
import { recordAIMetrics } from '../db/metricsDb.js';
import {
  createRecurringActivity,
  findSimilarActivity,
  type RecurringActivity,
} from '../db/recurringActivitiesDb.js';

/**
 * Prepared statement for querying upcoming TODOs
 * Gets pending TODOs due within the next 24 hours
 */
const todoStmt = db.prepare(`
  SELECT description, due_date
  FROM todos
  WHERE user_id = ? AND status = 'pending'
    AND due_date IS NOT NULL
    AND due_date BETWEEN ? AND ?
  ORDER BY due_date ASC
`);

/**
 * Get upcoming TODOs for a user (next 24 hours)
 *
 * @param userId - User ID
 * @returns Array of upcoming TODOs
 */
export function getUpcomingTodos(userId: string): Array<{ description: string; dueDate?: Date }> {
  const now = new Date();
  const next24h = addHours(now, 24);

  const rows = todoStmt.all(userId, now.toISOString(), next24h.toISOString()) as any[];

  return rows.map(row => {
    const todo: { description: string; dueDate?: Date } = {
      description: row.description,
    };

    if (row.due_date) {
      todo.dueDate = new Date(row.due_date);
    }

    return todo;
  });
}

/**
 * Get upcoming calendar events for a user (next 24 hours)
 *
 * @param auth - OAuth2 client for the user
 * @returns Array of upcoming events
 */
export async function getUpcomingEvents(
  auth: OAuth2Client
): Promise<Array<{ summary: string; start: Date; end?: Date }>> {
  const calendar = google.calendar({ version: 'v3', auth });
  const now = new Date();
  const next24h = addHours(now, 24);

  try {
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: next24h.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    return (res.data.items || []).map(evt => {
      const event: { summary: string; start: Date; end?: Date } = {
        summary: evt.summary || '(No title)',
        start: new Date(evt.start?.dateTime || evt.start?.date || new Date()),
      };

      if (evt.end?.dateTime || evt.end?.date) {
        event.end = new Date(evt.end.dateTime || evt.end.date || '');
      }

      return event;
    });
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    return []; // Return empty array on error
  }
}

/**
 * Generate complete daily summary for a user (legacy - kept for compatibility)
 *
 * @param userId - User ID
 * @param auth - OAuth2 client for the user
 * @returns Daily summary with TODOs and events
 */
export async function generateSummary(
  userId: string,
  auth: OAuth2Client
): Promise<{ todos: Array<{ description: string; dueDate?: Date }>; events: Array<{ summary: string; start: Date; end?: Date }> }> {
  return {
    todos: getUpcomingTodos(userId),
    events: await getUpcomingEvents(auth),
  };
}

/**
 * Generate complete inbox summary with AI analysis
 *
 * This is the main function for generating daily email summaries.
 * It performs the full pipeline:
 * 1. Fetches recent emails from Gmail
 * 2. Prepares data (emails + TODOs + calendar events)
 * 3. Sends to AI for analysis and categorization
 * 4. Renders HTML email
 *
 * @param userId - User ID
 * @param auth - OAuth2 client for the user
 * @param dateRange - Date range for email fetching (default: 'yesterday')
 * @param maxResults - Maximum number of emails to fetch (default: 100)
 * @param aiProvider - AI provider to use (default: 'openai')
 * @returns Object containing AI summary and rendered HTML
 */
/**
 * Get human-readable date range description
 */
function getDateRangeDescription(dateRange: DateRange): string {
  switch (dateRange) {
    case 'today':
      return 'today';
    case 'yesterday':
      return 'yesterday';
    case 'last3days':
      return 'the last 3 days';
    case 'last7days':
      return 'the last 7 days';
    case 'last30days':
      return 'the last 30 days';
    case 'last90days':
      return 'the last 3 months';
    default:
      return 'the last 7 days';
  }
}

export async function generateInboxSummary(
  userId: string,
  auth: OAuth2Client,
  dateRange: DateRange = 'yesterday',
  maxResults: number = 100,
  aiProvider: AIProvider = 'openai'
): Promise<{
  summary: SchoolSummary;
  html: string;
  emailCount: number;
}> {
  // Step 1: Fetch emails from Gmail with full body and attachment content
  const emails = await fetchRecentEmailsWithBody(auth, dateRange, maxResults);
  const dateRangeDesc = getDateRangeDescription(dateRange);

  // If no emails, return empty summary
  if (emails.length === 0) {
    const emptySummary: SchoolSummary = {
      email_analysis: {
        total_received: 0,
        signal_count: 0,
        noise_count: 0,
        noise_examples: [],
      },
      summary: [
        {
          child: 'General',
          icon: '✅',
          text: 'No new school emails or messages to review!',
        },
      ],
      kit_list: {
        tomorrow: [],
        upcoming: [],
      },
      financials: [],
      attachments_requiring_review: [],
      calendar_updates: [],
      recurring_activities: [],
      pro_dad_insight: 'Enjoy the quiet day - no school logistics to worry about!',
    };

    return {
      summary: emptySummary,
      html: renderSummaryEmail(emptySummary, 0, 0, dateRangeDesc),
      emailCount: 0,
    };
  }

  // Step 2: Sanitize and prepare for AI
  const sanitized = sanitizeEmails(emails);
  const aiInput = await prepareEmailsForAI(userId, auth, sanitized);

  // Step 3: Run AI analysis (AI now tracks signal/noise internally)
  const startTime = Date.now();
  const summary = await analyzeInbox(aiInput, aiProvider);
  const responseTimeMs = Date.now() - startTime;

  // Step 3.5: VALIDATE AI output before rendering
  const validation = validateSchoolSummary(summary, emails.length);

  // Log validation results
  if (!validation.valid) {
    console.error('❌ AI summary validation FAILED:');
    console.error(formatValidationErrors(validation));

    // Record failed metrics
    recordAIMetrics({
      user_id: userId,
      provider: aiProvider,
      emails_total: emails.length,
      emails_signal: summary.email_analysis?.signal_count || 0,
      emails_noise: summary.email_analysis?.noise_count || 0,
      validation_passed: false,
      validation_errors: JSON.stringify(validation.errors),
      response_time_ms: responseTimeMs,
      schema_validated: aiProvider === 'openai',
    });

    throw new Error(
      `AI generated invalid summary with ${validation.errors.length} error(s): ${validation.errors[0]}`
    );
  }

  if (validation.warnings.length > 0) {
    console.warn('⚠️ AI summary has warnings:');
    console.warn(formatValidationErrors(validation));
  } else {
    console.log('✅ AI summary validation passed');
  }

  // Count attachments
  const attachmentsTotal = emails.reduce((sum, email) => sum + (email.hasAttachments ? 1 : 0), 0);

  // Record successful metrics
  recordAIMetrics({
    user_id: userId,
    provider: aiProvider,
    emails_total: emails.length,
    emails_signal: summary.email_analysis.signal_count,
    emails_noise: summary.email_analysis.noise_count,
    attachments_total: attachmentsTotal,
    attachments_extracted: attachmentsTotal, // All extracted if we got here
    attachments_failed: 0,
    validation_passed: true,
    validation_errors: validation.warnings.length > 0 ? JSON.stringify(validation.warnings) : undefined,
    response_time_ms: responseTimeMs,
    financials_count: summary.financials.length,
    calendar_updates_count: summary.calendar_updates.length,
    attachments_review_count: summary.attachments_requiring_review.length,
    kit_tomorrow_count: summary.kit_list.tomorrow.length,
    schema_validated: aiProvider === 'openai',
  });

  console.log(`📊 Metrics recorded: ${responseTimeMs}ms response time, ${summary.email_analysis.signal_count} signal emails`);

  // Step 3.5: Store recurring activities (if any detected by AI)
  if (summary.recurring_activities && summary.recurring_activities.length > 0) {
    let newActivitiesCount = 0;
    let duplicatesSkipped = 0;

    for (const activity of summary.recurring_activities) {
      // Convert AI output to RecurringActivity format
      const recurringActivity: RecurringActivity = {
        user_id: userId,
        description: activity.description,
        child: activity.child,
        days_of_week: activity.days_of_week,
        frequency: activity.frequency,
        requires_kit: activity.requires_kit,
        kit_items: activity.kit_items,
      };

      // Check if similar activity already exists
      const existing = findSimilarActivity(recurringActivity);

      if (existing) {
        duplicatesSkipped++;
        console.log(
          `⏭️  Skipping duplicate recurring activity: ${activity.child} - ${activity.description} on ${activity.days_of_week.map(d => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d - 1]).join(', ')}`
        );
      } else {
        // Create new recurring activity
        const activityId = createRecurringActivity(recurringActivity);
        newActivitiesCount++;
        console.log(
          `✅ Created recurring activity #${activityId}: ${activity.child} - ${activity.description} on ${activity.days_of_week.map(d => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d - 1]).join(', ')}`
        );
      }
    }

    if (newActivitiesCount > 0) {
      console.log(`🔁 Stored ${newActivitiesCount} new recurring activities (${duplicatesSkipped} duplicates skipped)`);
    }
  }

  // Step 4: Render HTML with date range description
  const html = renderSummaryEmail(summary, undefined, undefined, dateRangeDesc);

  return {
    summary,
    html,
    emailCount: summary.email_analysis.signal_count,
  };
}
