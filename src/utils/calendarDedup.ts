// src/utils/calendarDedup.ts
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { compareTwoStrings } from 'string-similarity';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { formatISO } from 'date-fns';
import type { EventData } from '../types/calendar.js';

/**
 * Check if a similar event already exists in Google Calendar
 * Uses fuzzy string matching and time window to detect duplicates
 *
 * @param auth - OAuth2 client for the user
 * @param calendarId - Calendar ID (default: 'primary')
 * @param eventData - Event to check for duplicates
 * @param userTimeZone - User's IANA timezone (e.g., 'America/Los_Angeles')
 * @returns true if duplicate found, false otherwise
 */
export async function checkForDuplicate(
  auth: OAuth2Client,
  calendarId: string,
  eventData: EventData,
  userTimeZone: string
): Promise<boolean> {
  try {
    const calendar = google.calendar({ version: 'v3', auth });

    // Create ±1 day window in user's timezone
    const startDate = toZonedTime(new Date(eventData.start.dateTime), userTimeZone);
    const timeMin = fromZonedTime(
      new Date(startDate.getTime() - 24 * 60 * 60 * 1000),
      userTimeZone
    );
    const timeMax = fromZonedTime(
      new Date(startDate.getTime() + 24 * 60 * 60 * 1000),
      userTimeZone
    );

    // Query calendar for events in the time window
    const response = await calendar.events.list({
      calendarId,
      timeMin: formatISO(timeMin),
      timeMax: formatISO(timeMax),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const existingEvents = response.data.items;
    if (!existingEvents || existingEvents.length === 0) {
      return false;
    }

    // Check each existing event for similarity
    for (const existing of existingEvents) {
      // Fuzzy match summary (threshold 0.7 for high similarity)
      const summaryMatch =
        compareTwoStrings(
          eventData.summary.toLowerCase(),
          (existing.summary || '').toLowerCase()
        ) > 0.7;

      // Fuzzy match description if both exist
      let descMatch = true;
      if (eventData.description && existing.description) {
        descMatch =
          compareTwoStrings(
            eventData.description.toLowerCase(),
            existing.description.toLowerCase()
          ) > 0.7;
      }

      // Check time overlap (within 1 hour)
      const existingStart = new Date(existing.start?.dateTime || existing.start?.date || '');
      const newStart = new Date(eventData.start.dateTime);
      const timeDiffMs = Math.abs(existingStart.getTime() - newStart.getTime());
      const timeOverlap = timeDiffMs < 60 * 60 * 1000; // 1 hour in milliseconds

      // If summary matches, description matches, and times overlap, it's a duplicate
      if (summaryMatch && descMatch && timeOverlap) {
        console.log(
          `Duplicate event found: "${eventData.summary}" similar to "${existing.summary}"`
        );
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error('Error checking for duplicate events:', error);
    // On error, assume no duplicate to avoid blocking event creation
    return false;
  }
}
