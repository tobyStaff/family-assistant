// src/utils/calendarIntegration.ts

import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { ExtractedEvent } from '../types/extraction.js';

/**
 * Create calendar event with 7pm reminder day before
 *
 * @param auth - OAuth2 client
 * @param event - Extracted event from AI
 * @returns Created event ID
 */
export async function createCalendarEvent(
  auth: OAuth2Client,
  event: ExtractedEvent
): Promise<string> {
  const calendar = google.calendar({ version: 'v3', auth });

  // Parse event date
  const eventDate = new Date(event.date);
  const endDate = event.end_date ? new Date(event.end_date) : eventDate;

  // Calculate reminder time: 7pm (19:00) day before
  const reminderDate = new Date(eventDate);
  reminderDate.setDate(reminderDate.getDate() - 1);
  reminderDate.setHours(19, 0, 0, 0);

  // Calculate minutes before event for reminder
  const minutesBeforeEvent = Math.floor(
    (eventDate.getTime() - reminderDate.getTime()) / (1000 * 60)
  );

  // Build event description with metadata
  let description = event.description || '';
  if (event.child_name) {
    description = `Child: ${event.child_name}\n\n${description}`;
  }
  if (event.confidence !== undefined) {
    description += `\n\nAI Confidence: ${Math.round(event.confidence * 100)}%`;
  }
  if (event.source_email_id) {
    description += `\n\nSource Email ID: ${event.source_email_id}`;
  }

  const calendarEvent = {
    summary: event.title,
    description,
    location: event.location,
    start: {
      dateTime: event.date,
      timeZone: 'Europe/London', // TODO: Make configurable per user
    },
    end: {
      dateTime: endDate.toISOString(),
      timeZone: 'Europe/London',
    },
    reminders: {
      useDefault: false,
      overrides: [
        {
          method: 'popup' as const,
          minutes: minutesBeforeEvent > 0 ? minutesBeforeEvent : 60, // Fallback to 1 hour if same-day event
        },
      ],
    },
    // Add color coding based on child or event type
    colorId: event.child_name ? '9' : '1', // Blue for child-specific, light blue for general
  };

  try {
    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: calendarEvent,
    });

    return response.data.id!;
  } catch (error: any) {
    console.error('Error creating calendar event:', error);
    throw new Error(`Failed to create calendar event: ${error.message}`);
  }
}

/**
 * Batch create calendar events
 *
 * @param auth - OAuth2 client
 * @param events - Array of extracted events
 * @returns Array of created event IDs
 */
export async function createCalendarEventsBatch(
  auth: OAuth2Client,
  events: ExtractedEvent[]
): Promise<string[]> {
  const ids: string[] = [];

  for (const event of events) {
    try {
      const id = await createCalendarEvent(auth, event);
      ids.push(id);
      console.log(`✅ Created calendar event: ${event.title} (ID: ${id})`);
    } catch (error: any) {
      console.error(`❌ Failed to create event "${event.title}":`, error.message);
      // Continue with other events even if one fails
    }
  }

  return ids;
}

/**
 * Check if event already exists in calendar (to avoid duplicates)
 *
 * @param auth - OAuth2 client
 * @param eventTitle - Title to search for
 * @param eventDate - Date of the event
 * @returns true if event exists, false otherwise
 */
export async function eventExists(
  auth: OAuth2Client,
  eventTitle: string,
  eventDate: string
): Promise<boolean> {
  const calendar = google.calendar({ version: 'v3', auth });

  try {
    const startDate = new Date(eventDate);
    const endDate = new Date(eventDate);
    endDate.setHours(23, 59, 59, 999); // End of same day

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      q: eventTitle, // Search by title
      singleEvents: true,
    });

    return (response.data.items?.length || 0) > 0;
  } catch (error) {
    console.error('Error checking event existence:', error);
    return false; // Assume doesn't exist if check fails
  }
}

/**
 * Get upcoming events from calendar
 *
 * @param auth - OAuth2 client
 * @param daysAhead - Number of days to look ahead (default: 7)
 * @returns Array of upcoming events
 */
export async function getUpcomingEvents(
  auth: OAuth2Client,
  daysAhead: number = 7
): Promise<
  Array<{
    id: string;
    summary: string;
    start: Date;
    end?: Date;
    description?: string;
    location?: string;
  }>
> {
  const calendar = google.calendar({ version: 'v3', auth });

  const now = new Date();
  const future = new Date();
  future.setDate(future.getDate() + daysAhead);

  try {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 100,
    });

    return (response.data.items || []).map((evt) => ({
      id: evt.id!,
      summary: evt.summary || '(No title)',
      start: new Date(evt.start?.dateTime || evt.start?.date || ''),
      end: evt.end?.dateTime || evt.end?.date ? new Date(evt.end.dateTime || evt.end.date!) : undefined,
      description: evt.description,
      location: evt.location,
    }));
  } catch (error: any) {
    console.error('Error fetching calendar events:', error);
    throw new Error(`Failed to fetch calendar events: ${error.message}`);
  }
}

/**
 * Delete calendar event
 *
 * @param auth - OAuth2 client
 * @param eventId - Event ID to delete
 * @returns true if deleted successfully
 */
export async function deleteCalendarEvent(
  auth: OAuth2Client,
  eventId: string
): Promise<boolean> {
  const calendar = google.calendar({ version: 'v3', auth });

  try {
    await calendar.events.delete({
      calendarId: 'primary',
      eventId,
    });
    return true;
  } catch (error: any) {
    console.error(`Error deleting calendar event ${eventId}:`, error);
    return false;
  }
}

/**
 * Sync events from database to Google Calendar
 *
 * @param userId - User ID
 * @param auth - OAuth2 client
 * @param eventIds - Array of event IDs to sync
 * @returns Sync result statistics
 */
export async function syncEventsToCalendar(
  userId: string,
  auth: OAuth2Client,
  eventIds: number[]
): Promise<{
  synced: number;
  failed: number;
  errors: Array<{ eventId: number; error: string }>;
}> {
  const { getEvent, markEventSynced, markEventSyncFailed } =
    await import('../db/eventDb.js');

  const result = { synced: 0, failed: 0, errors: [] as Array<{ eventId: number; error: string }> };

  for (const eventId of eventIds) {
    try {
      const event = getEvent(userId, eventId);
      if (!event) {
        console.warn(`Event ${eventId} not found in database`);
        continue;
      }

      // Skip if already synced
      if (event.sync_status === 'synced' && event.google_calendar_event_id) {
        console.log(`Event ${eventId} already synced, skipping`);
        result.synced++;
        continue;
      }

      // Convert to ExtractedEvent format
      const extractedEvent: ExtractedEvent = {
        title: event.title,
        date: event.date.toISOString(),
        end_date: event.end_date?.toISOString(),
        description: event.description,
        location: event.location,
        child_name: event.child_name,
        source_email_id: event.source_email_id,
        confidence: event.confidence || 0,
      };

      // Create in Google Calendar
      const googleEventId = await createCalendarEvent(auth, extractedEvent);
      markEventSynced(userId, eventId, googleEventId);

      console.log(`✅ Synced event ${eventId}: ${event.title}`);
      result.synced++;
    } catch (error: any) {
      console.error(`❌ Failed to sync event ${eventId}:`, error.message);
      markEventSyncFailed(userId, eventId, error.message);
      result.failed++;
      result.errors.push({ eventId, error: error.message });
    }
  }

  return result;
}

/**
 * Check if event exists anywhere (local DB or Google Calendar)
 *
 * @param userId - User ID
 * @param auth - OAuth2 client
 * @param event - Event to check
 * @returns true if event exists
 */
export async function eventExistsAnywhere(
  userId: string,
  auth: OAuth2Client,
  event: ExtractedEvent
): Promise<boolean> {
  const { eventExistsInDb } = await import('../db/eventDb.js');

  // Check local DB first (fast)
  if (event.source_email_id) {
    const existsInDb = eventExistsInDb(userId, event.source_email_id, event.title, event.date);
    if (existsInDb) {
      console.log(`Event "${event.title}" exists in local DB`);
      return true;
    }
  }

  // Fallback to Calendar API (slower)
  const existsInCalendar = await eventExists(auth, event.title, event.date);
  if (existsInCalendar) {
    console.log(`Event "${event.title}" exists in Google Calendar`);
  }
  return existsInCalendar;
}
