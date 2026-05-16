// src/tracking/trackingDb.ts
//
// All schema and queries for the tracking events table. The schema lives here
// (CREATE TABLE IF NOT EXISTS) rather than in the central db.ts migrations so
// the module can be removed in one step: delete src/tracking/ + drop the
// registerTracking() call in app.ts + drop the trackingScript interpolation
// from any template. The table remains in the SQLite file harmlessly.
//
// To inspect data ad-hoc:
//   docker exec inbox-manager sqlite3 /app/data/app.db \
//     "SELECT event_type, COUNT(*) FROM tracking_events GROUP BY event_type;"
//   docker exec inbox-manager sqlite3 /app/data/app.db \
//     "SELECT visitor_id, COUNT(*) FROM tracking_events \
//      WHERE created_at > datetime('now', '-1 day') \
//      GROUP BY visitor_id ORDER BY 2 DESC LIMIT 20;"

import db from '../db/db.js';

export interface TrackingEventInput {
  visitorId: string;
  userId: string | null;
  eventType: string;
  path: string;
  target: string | null; // JSON-stringified, or null
  userAgent: string | null;
  referrer: string | null;
}

export interface TrackingEvent extends TrackingEventInput {
  id: number;
  created_at: string;
}

/**
 * Idempotent schema setup. Safe to call on every server boot.
 */
export function ensureTrackingSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracking_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_id TEXT NOT NULL,
      user_id TEXT,
      event_type TEXT NOT NULL,
      path TEXT NOT NULL,
      target TEXT,
      user_agent TEXT,
      referrer TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_tracking_visitor ON tracking_events(visitor_id);
    CREATE INDEX IF NOT EXISTS idx_tracking_user ON tracking_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_tracking_event_type ON tracking_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_tracking_created ON tracking_events(created_at);
  `);
}

/**
 * Insert one tracking event.
 */
export function insertTrackingEvent(event: TrackingEventInput): void {
  db.prepare(`
    INSERT INTO tracking_events
      (visitor_id, user_id, event_type, path, target, user_agent, referrer)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.visitorId,
    event.userId,
    event.eventType,
    event.path,
    event.target,
    event.userAgent,
    event.referrer,
  );
}

/**
 * Fetch recent events for ad-hoc inspection. Not used by any route yet.
 */
export function getRecentTrackingEvents(limit: number = 100): TrackingEvent[] {
  return db.prepare(`
    SELECT id, visitor_id as visitorId, user_id as userId, event_type as eventType,
           path, target, user_agent as userAgent, referrer, created_at
    FROM tracking_events
    ORDER BY id DESC
    LIMIT ?
  `).all(limit) as TrackingEvent[];
}
