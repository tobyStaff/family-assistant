// src/types/calendar.ts

/**
 * Event data structure for Google Calendar API
 * Aligned with calendar_v3.Schema$Event from googleapis
 */
export interface EventData {
  summary: string; // Event title
  description?: string; // Event description
  start: {
    dateTime: string; // ISO 8601 format with timezone
    timeZone: string; // IANA timezone (e.g., 'America/Los_Angeles')
  };
  end?: {
    dateTime: string;
    timeZone: string;
  };
  location?: string; // Optional location for future parser support
}

/**
 * Request body for adding calendar event
 */
export interface AddEventRequest {
  summary: string;
  description?: string;
  start: Date; // Parsed date from email (UTC)
  end?: Date; // Optional end date
  parsedTimeZone?: string; // Timezone extracted by parser, if any
}
