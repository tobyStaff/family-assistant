// src/db/eventDb.ts
import db from './db.js';
import type { ExtractedEvent } from '../types/extraction.js';

/**
 * Sync status for events
 */
export type EventSyncStatus = 'pending' | 'synced' | 'failed';

/**
 * Event interface for database storage
 */
export interface Event {
  id: number;
  user_id: string;
  title: string;
  date: Date;
  end_date?: Date;
  description?: string;
  location?: string;
  child_name?: string;
  source_email_id?: string;
  confidence?: number;
  sync_status: EventSyncStatus;
  google_calendar_event_id?: string;
  last_sync_attempt?: Date;
  sync_error?: string;
  retry_count: number;
  created_at: Date;
  updated_at: Date;
  synced_at?: Date;
  // Enhanced fields (Task 1.9)
  recurring?: boolean;
  recurrence_pattern?: string;
  time_of_day?: string;
  inferred_date?: boolean;
}

/**
 * Input type for creating events with all fields
 */
export interface CreateEventInput {
  title: string;
  date: string;
  end_date?: string;
  description?: string;
  location?: string;
  child_name?: string;
  source_email_id?: string;
  confidence?: number;
  recurring?: boolean;
  recurrence_pattern?: string;
  time_of_day?: string;
  inferred_date?: boolean;
}

/**
 * Prepared statements for better performance and SQL injection protection
 */

// INSERT statement for creating events from AI extraction (legacy)
const insertExtractedStmt = db.prepare(`
  INSERT INTO events (
    user_id, title, date, end_date, description, location,
    child_name, source_email_id, confidence, sync_status
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
`);

// INSERT statement for creating events with enhanced fields (Task 1.9)
const insertEnhancedStmt = db.prepare(`
  INSERT INTO events (
    user_id, title, date, end_date, description, location,
    child_name, source_email_id, confidence, recurring,
    recurrence_pattern, time_of_day, inferred_date, sync_status
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
`);

// SELECT statement for listing user's events
const listStmt = db.prepare(`
  SELECT * FROM events
  WHERE user_id = ?
  ORDER BY date ASC, created_at DESC
`);

// SELECT statement for getting a single event
const getStmt = db.prepare(`
  SELECT * FROM events
  WHERE id = ? AND user_id = ?
`);

// SELECT statement for getting pending/failed events for sync retry
const getPendingSyncStmt = db.prepare(`
  SELECT * FROM events
  WHERE user_id = ?
    AND sync_status IN ('pending', 'failed')
    AND retry_count < ?
  ORDER BY created_at ASC
  LIMIT 100
`);

// UPDATE statement for marking event as synced
const markSyncedStmt = db.prepare(`
  UPDATE events
  SET sync_status = 'synced',
      google_calendar_event_id = ?,
      synced_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND user_id = ?
`);

// UPDATE statement for marking event sync as failed
const markSyncFailedStmt = db.prepare(`
  UPDATE events
  SET sync_status = 'failed',
      sync_error = ?,
      last_sync_attempt = CURRENT_TIMESTAMP,
      retry_count = retry_count + 1,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND user_id = ?
`);

// SELECT statement for checking if event exists in DB
const eventExistsStmt = db.prepare(`
  SELECT COUNT(*) as count FROM events
  WHERE user_id = ?
    AND source_email_id = ?
    AND title = ?
    AND date = ?
`);

// SELECT statement for upcoming events
const upcomingEventsStmt = db.prepare(`
  SELECT * FROM events
  WHERE user_id = ?
    AND date >= datetime('now')
    AND date <= datetime('now', '+' || ? || ' days')
  ORDER BY date ASC
  LIMIT 20
`);

// DELETE statement for removing events
const deleteStmt = db.prepare(`
  DELETE FROM events
  WHERE id = ? AND user_id = ?
`);

/**
 * Helper function to map database row to Event object
 */
function mapRowToEvent(row: any): Event {
  const event: Event = {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    date: new Date(row.date),
    sync_status: row.sync_status as EventSyncStatus,
    retry_count: row.retry_count || 0,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };

  if (row.end_date) {
    event.end_date = new Date(row.end_date);
  }

  if (row.description) {
    event.description = row.description;
  }

  if (row.location) {
    event.location = row.location;
  }

  if (row.child_name) {
    event.child_name = row.child_name;
  }

  if (row.source_email_id) {
    event.source_email_id = row.source_email_id;
  }

  if (row.confidence !== null && row.confidence !== undefined) {
    event.confidence = row.confidence;
  }

  if (row.google_calendar_event_id) {
    event.google_calendar_event_id = row.google_calendar_event_id;
  }

  if (row.last_sync_attempt) {
    event.last_sync_attempt = new Date(row.last_sync_attempt);
  }

  if (row.sync_error) {
    event.sync_error = row.sync_error;
  }

  if (row.synced_at) {
    event.synced_at = new Date(row.synced_at);
  }

  // Enhanced fields (Task 1.9)
  if (row.recurring !== null && row.recurring !== undefined) {
    event.recurring = Boolean(row.recurring);
  }

  if (row.recurrence_pattern) {
    event.recurrence_pattern = row.recurrence_pattern;
  }

  if (row.time_of_day) {
    event.time_of_day = row.time_of_day;
  }

  if (row.inferred_date !== null && row.inferred_date !== undefined) {
    event.inferred_date = Boolean(row.inferred_date);
  }

  return event;
}

/**
 * Create an event with all fields (enhanced version)
 */
export function createEvent(userId: string, input: CreateEventInput): number {
  const result = insertEnhancedStmt.run(
    userId,
    input.title,
    input.date,
    input.end_date || null,
    input.description || null,
    input.location || null,
    input.child_name || null,
    input.source_email_id || null,
    input.confidence || null,
    input.recurring ? 1 : 0,
    input.recurrence_pattern || null,
    input.time_of_day || null,
    input.inferred_date ? 1 : 0
  );

  return result.lastInsertRowid as number;
}

/**
 * Create an event from AI extraction (legacy)
 */
export function createEventFromExtraction(userId: string, event: ExtractedEvent): number {
  const result = insertExtractedStmt.run(
    userId,
    event.title,
    event.date, // ISO8601 string
    event.end_date || null,
    event.description || null,
    event.location || null,
    event.child_name || null,
    event.source_email_id || null,
    event.confidence || null
  );

  return result.lastInsertRowid as number;
}

/**
 * Create multiple events in a single transaction (batch operation)
 */
export function createEventsBatch(userId: string, events: ExtractedEvent[]): number[] {
  const eventIds: number[] = [];

  const transaction = db.transaction(() => {
    for (const event of events) {
      try {
        const id = createEventFromExtraction(userId, event);
        eventIds.push(id);
      } catch (error: any) {
        // Handle unique constraint violations (duplicates)
        if (error.code === 'SQLITE_CONSTRAINT') {
          console.log(`Skipping duplicate event: ${event.title} on ${event.date}`);
        } else {
          throw error;
        }
      }
    }
  });

  transaction();
  return eventIds;
}

/**
 * List all events for a user
 */
export function listEvents(userId: string): Event[] {
  const rows = listStmt.all(userId);
  return rows.map(mapRowToEvent);
}

/**
 * Get a single event by ID
 */
export function getEvent(userId: string, id: number): Event | null {
  const row = getStmt.get(id, userId);
  return row ? mapRowToEvent(row) : null;
}

/**
 * Get events with advanced filtering
 */
export function getEvents(
  userId: string,
  filters?: {
    status?: EventSyncStatus;
    child?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }
): Event[] {
  let query = 'SELECT * FROM events WHERE user_id = ?';
  const params: any[] = [userId];

  if (filters?.status) {
    query += ' AND sync_status = ?';
    params.push(filters.status);
  }

  if (filters?.child) {
    query += ' AND child_name = ?';
    params.push(filters.child);
  }

  if (filters?.dateFrom) {
    query += ' AND date >= ?';
    params.push(filters.dateFrom.toISOString());
  }

  if (filters?.dateTo) {
    query += ' AND date <= ?';
    params.push(filters.dateTo.toISOString());
  }

  query += ' ORDER BY date ASC, created_at DESC';

  const stmt = db.prepare(query);
  const rows = stmt.all(...params);
  return rows.map(mapRowToEvent);
}

/**
 * Get pending/failed events for sync retry
 */
export function getPendingSyncEvents(userId: string, maxRetries: number = 5): Event[] {
  const rows = getPendingSyncStmt.all(userId, maxRetries);
  return rows.map(mapRowToEvent);
}

/**
 * Mark an event as successfully synced to Google Calendar
 */
export function markEventSynced(
  userId: string,
  eventId: number,
  googleCalendarEventId: string
): void {
  markSyncedStmt.run(googleCalendarEventId, eventId, userId);
}

/**
 * Mark an event sync as failed
 */
export function markEventSyncFailed(userId: string, eventId: number, error: string): void {
  markSyncFailedStmt.run(error, eventId, userId);
}

/**
 * Check if an event exists in the database (duplicate detection)
 */
export function eventExistsInDb(
  userId: string,
  sourceEmailId: string,
  title: string,
  date: string
): boolean {
  const result = eventExistsStmt.get(userId, sourceEmailId, title, date) as { count: number };
  return result.count > 0;
}

/**
 * Get upcoming events for dashboard display
 */
export function getUpcomingEvents(userId: string, daysAhead: number = 7): Event[] {
  const rows = upcomingEventsStmt.all(userId, daysAhead);
  return rows.map(mapRowToEvent);
}

/**
 * Delete an event
 */
export function deleteEvent(userId: string, id: number): boolean {
  const result = deleteStmt.run(id, userId);
  return result.changes > 0;
}

/**
 * Get event statistics by sync status
 */
export function getEventStats(userId: string): {
  total: number;
  pending: number;
  synced: number;
  failed: number;
} {
  const statsStmt = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN sync_status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN sync_status = 'synced' THEN 1 ELSE 0 END) as synced,
      SUM(CASE WHEN sync_status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM events
    WHERE user_id = ?
  `);

  const result = statsStmt.get(userId) as any;

  return {
    total: result.total || 0,
    pending: result.pending || 0,
    synced: result.synced || 0,
    failed: result.failed || 0,
  };
}
