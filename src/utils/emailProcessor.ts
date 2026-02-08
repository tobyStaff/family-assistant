// src/utils/emailProcessor.ts

import type { OAuth2Client } from 'google-auth-library';
import type { DateRange } from './inboxFetcher.js';
import { fetchRecentEmailsWithBody } from './inboxFetcher.js';
import { extractEventsAndTodos } from '../parsers/eventTodoExtractor.js';
import { createCalendarEventsBatch, eventExists } from './calendarIntegration.js';
import { createTodosBatch } from '../db/todoDb.js';
import { markEmailAsProcessed, isEmailProcessed } from '../db/processedEmailsDb.js';
import { cleanupPastItems } from './cleanupPastItems.js';
import { isCalendarConnected } from '../db/userDb.js';

/**
 * Result from processing emails
 */
export interface ProcessingResult {
  success: boolean;
  emails_fetched: number;
  emails_processed: number;
  emails_skipped: number; // Already processed
  events_created: number;
  todos_created: number;
  errors: string[];
  processing_time_ms: number;
}

/**
 * Options for email processing
 */
export interface ProcessingOptions {
  dateRange: DateRange;
  maxResults?: number;
  aiProvider?: 'openai' | 'anthropic';
  skipDuplicateEvents?: boolean; // Check if events already exist in calendar
}

/**
 * Process emails: Fetch → Extract → Store
 *
 * This is the main pipeline orchestrator that combines:
 * - Step 1: Email & Attachment Fetching
 * - Step 2: AI Extraction (Events & Todos)
 * - Step 3: Database Storage (Calendar + Todos)
 *
 * @param userId - User ID
 * @param auth - OAuth2 client
 * @param options - Processing options
 * @returns Processing result with stats
 */
export async function processEmails(
  userId: string,
  auth: OAuth2Client,
  options: ProcessingOptions
): Promise<ProcessingResult> {
  const startTime = Date.now();
  const result: ProcessingResult = {
    success: false,
    emails_fetched: 0,
    emails_processed: 0,
    emails_skipped: 0,
    events_created: 0,
    todos_created: 0,
    errors: [],
    processing_time_ms: 0,
  };

  try {
    console.log(`📧 Starting email processing for user ${userId}`);
    console.log(`   Date range: ${options.dateRange}`);
    console.log(`   Max results: ${options.maxResults || 'unlimited'}`);
    console.log(`   AI provider: ${options.aiProvider || 'openai'}`);

    // Step 1: Fetch emails with body content
    console.log('\n📥 Step 1: Fetching emails...');
    const emails = await fetchRecentEmailsWithBody(
      auth,
      options.dateRange,
      options.maxResults || 100
    );

    result.emails_fetched = emails.length;
    console.log(`✅ Fetched ${emails.length} emails`);

    if (emails.length === 0) {
      console.log('ℹ️  No emails to process');
      result.success = true;
      result.processing_time_ms = Date.now() - startTime;
      return result;
    }

    // Filter out already processed emails (idempotency)
    console.log('\n🔍 Checking for already processed emails...');
    const unprocessedEmails = [];
    for (const email of emails) {
      if (isEmailProcessed(userId, email.id)) {
        result.emails_skipped++;
      } else {
        unprocessedEmails.push(email);
      }
    }

    console.log(`✅ ${unprocessedEmails.length} new emails to process`);
    console.log(`⏭️  ${result.emails_skipped} emails already processed (skipped)`);

    if (unprocessedEmails.length === 0) {
      console.log('ℹ️  All emails already processed');
      result.success = true;
      result.processing_time_ms = Date.now() - startTime;
      return result;
    }

    // Step 2: Extract events and todos with AI
    console.log('\n🤖 Step 2: Extracting events and todos with AI...');
    const extraction = await extractEventsAndTodos(
      unprocessedEmails,
      options.aiProvider || 'openai'
    );

    console.log(`✅ Extraction complete:`);
    console.log(`   - ${extraction.events.length} events found`);
    console.log(`   - ${extraction.todos.length} todos found`);

    // Step 3: Store in database, cleanup old items, then sync to calendar
    console.log('\n💾 Step 3: Storing events and todos...');

    // 3a: Save events to database
    let eventIds: number[] = [];
    if (extraction.events.length > 0) {
      console.log(`\n📅 Saving ${extraction.events.length} events to database...`);

      const { createEventsBatch } = await import('../db/eventDb.js');
      eventIds = createEventsBatch(userId, extraction.events);
      console.log(`✅ Saved ${eventIds.length} events to database`);
    }

    // 3b: Create todos in database
    if (extraction.todos.length > 0) {
      console.log(`\n📝 Creating ${extraction.todos.length} todos...`);
      const todoIds = createTodosBatch(userId, extraction.todos);
      result.todos_created = todoIds.length;
      console.log(`✅ Created ${todoIds.length} todos`);
    }

    // 3c: Cleanup old items (>24h past) - filters out old events/todos before calendar sync
    console.log('\n🧹 Cleaning up past items...');
    const cleanup = cleanupPastItems(userId);
    if (cleanup.todosCompleted > 0 || cleanup.eventsRemoved > 0) {
      console.log(`✅ Cleanup: auto-completed ${cleanup.todosCompleted} todos, removed ${cleanup.eventsRemoved} events`);
    } else {
      console.log(`✅ No past items to clean up`);
    }

    // 3d: Sync remaining events to Google Calendar
    if (eventIds.length > 0) {
      // Filter out any event IDs that were just deleted by cleanup
      const remainingEventIds = eventIds.filter(id => !cleanup.eventIds.includes(id));

      if (remainingEventIds.length > 0 && isCalendarConnected(userId)) {
        console.log(`\n☁️  Syncing ${remainingEventIds.length} events to Google Calendar...`);
        const { syncEventsToCalendar } = await import('./calendarIntegration.js');
        const syncResult = await syncEventsToCalendar(userId, auth, remainingEventIds);

        result.events_created = syncResult.synced;

        console.log(`✅ Synced ${syncResult.synced} events to Calendar`);
        if (syncResult.failed > 0) {
          console.log(`⚠️  ${syncResult.failed} events failed to sync (will retry automatically)`);
        }
      } else if (remainingEventIds.length === 0) {
        console.log(`\n☁️  No events to sync (all were past items)`);
      } else {
        console.log(`\n☁️  Skipping calendar sync (calendar not connected)`);
      }
    }

    // 3e: Mark emails as processed
    console.log('\n✓ Marking emails as processed...');
    for (const email of unprocessedEmails) {
      markEmailAsProcessed(userId, email.id);
    }
    result.emails_processed = unprocessedEmails.length;
    console.log(`✅ Marked ${unprocessedEmails.length} emails as processed`);

    result.success = true;
    result.processing_time_ms = Date.now() - startTime;

    console.log('\n✅ Processing complete!');
    console.log(`   Time: ${result.processing_time_ms}ms`);
    console.log(`   Events created: ${result.events_created}`);
    console.log(`   Todos created: ${result.todos_created}`);

    return result;
  } catch (error: any) {
    console.error('❌ Processing failed:', error);
    result.success = false;
    result.errors.push(error.message);
    result.processing_time_ms = Date.now() - startTime;
    throw error;
  }
}

/**
 * Get processing status summary for user
 *
 * @param userId - User ID
 * @returns Summary of processed emails
 */
export function getProcessingStatus(userId: string): {
  total_processed: number;
  last_processed_at?: Date;
} {
  // This would query the processed_emails table
  // For now, return a placeholder
  return {
    total_processed: 0,
  };
}
