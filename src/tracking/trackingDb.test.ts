// src/tracking/trackingDb.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

vi.mock('../db/db.js', () => {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  return { default: testDb };
});

import {
  ensureTrackingSchema,
  insertTrackingEvent,
  getRecentTrackingEvents,
} from './trackingDb.js';
import db from '../db/db.js';

const testDb = db as unknown as Database.Database;

describe('trackingDb', () => {
  beforeEach(() => {
    // ensureTrackingSchema is idempotent, so we can call it every test
    ensureTrackingSchema();
    testDb.exec('DELETE FROM tracking_events');
  });

  describe('ensureTrackingSchema', () => {
    it('creates the tracking_events table', () => {
      const tableInfo = testDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tracking_events'")
        .get();
      expect(tableInfo).toBeDefined();
    });

    it('is idempotent — safe to call twice', () => {
      expect(() => {
        ensureTrackingSchema();
        ensureTrackingSchema();
      }).not.toThrow();
    });

    it('creates expected indexes', () => {
      const indexes = testDb
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='tracking_events'")
        .all() as Array<{ name: string }>;
      const names = indexes.map((i) => i.name);
      expect(names).toContain('idx_tracking_visitor');
      expect(names).toContain('idx_tracking_user');
      expect(names).toContain('idx_tracking_event_type');
      expect(names).toContain('idx_tracking_created');
    });
  });

  describe('insertTrackingEvent', () => {
    it('inserts an event with all fields', () => {
      insertTrackingEvent({
        visitorId: 'visitor-1',
        userId: 'user-1',
        eventType: 'pageview',
        path: '/',
        target: null,
        userAgent: 'Mozilla/5.0',
        referrer: 'https://google.com',
      });

      const row = testDb
        .prepare('SELECT * FROM tracking_events WHERE visitor_id = ?')
        .get('visitor-1') as Record<string, unknown>;
      expect(row.event_type).toBe('pageview');
      expect(row.path).toBe('/');
      expect(row.user_id).toBe('user-1');
      expect(row.referrer).toBe('https://google.com');
    });

    it('accepts null user_id for anonymous visitors', () => {
      insertTrackingEvent({
        visitorId: 'visitor-2',
        userId: null,
        eventType: 'scroll',
        path: '/',
        target: JSON.stringify({ depth: 50 }),
        userAgent: null,
        referrer: null,
      });

      const row = testDb
        .prepare('SELECT * FROM tracking_events WHERE visitor_id = ?')
        .get('visitor-2') as Record<string, unknown>;
      expect(row.user_id).toBeNull();
      expect(row.target).toBe('{"depth":50}');
    });

    it('populates created_at automatically', () => {
      insertTrackingEvent({
        visitorId: 'visitor-3',
        userId: null,
        eventType: 'click',
        path: '/',
        target: null,
        userAgent: null,
        referrer: null,
      });

      const row = testDb
        .prepare('SELECT created_at FROM tracking_events WHERE visitor_id = ?')
        .get('visitor-3') as { created_at: string };
      expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}/);
    });
  });

  describe('getRecentTrackingEvents', () => {
    it('returns events in reverse chronological order', () => {
      for (let i = 0; i < 5; i++) {
        insertTrackingEvent({
          visitorId: `visitor-${i}`,
          userId: null,
          eventType: 'pageview',
          path: '/',
          target: null,
          userAgent: null,
          referrer: null,
        });
      }

      const events = getRecentTrackingEvents(10);
      expect(events).toHaveLength(5);
      // Most recently inserted should be first (largest id)
      expect(events[0]!.visitorId).toBe('visitor-4');
      expect(events[4]!.visitorId).toBe('visitor-0');
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        insertTrackingEvent({
          visitorId: `visitor-${i}`,
          userId: null,
          eventType: 'pageview',
          path: '/',
          target: null,
          userAgent: null,
          referrer: null,
        });
      }

      const events = getRecentTrackingEvents(2);
      expect(events).toHaveLength(2);
    });
  });
});
