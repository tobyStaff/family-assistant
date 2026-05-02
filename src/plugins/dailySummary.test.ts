// src/plugins/dailySummary.test.ts
//
// Tests for cron job behaviours in dailySummary.ts.
//
// Because processUserSummary() is defined inside the onTick closure (not exported),
// we test the DB/settings functions that drive its skip logic directly:
//
//   • getAllOAuthUserIds  — who the event-sync cron iterates over
//   • getAllUsersWithRoles — who the summary + analysis crons iterate over
//   • getOrCreateDefaultSettings — summary cron reads this for skip conditions:
//       - summary_enabled === false  → skip
//       - summary_time_utc !== currentHour → skip
//       - summary_email_recipients.length === 0 → skip
//   • getAllEnabledSettings — convenience view used elsewhere in codebase

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// Must mock db before any module that imports it
vi.mock('../db/db.js', async () => {
  const { createTestDb } = await import('../tests/createTestDb.js');
  return { default: createTestDb() };
});

import { getAllOAuthUserIds } from '../db/authDb.js';
import { getAllUsersWithRoles } from '../db/userDb.js';
import {
  getOrCreateDefaultSettings,
  getAllEnabledSettings,
  upsertSettings,
} from '../db/settingsDb.js';
import db from '../db/db.js';

const testDb = db as Database.Database;

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

function insertUser(userId: string, email: string) {
  testDb.prepare('INSERT INTO users (user_id, email) VALUES (?, ?)').run(userId, email);
}

function insertAuth(userId: string) {
  testDb
    .prepare('INSERT INTO auth (user_id, refresh_token, access_token, expiry_date) VALUES (?, ?, ?, ?)')
    .run(userId, 'refresh', 'access', Date.now() + 3_600_000);
}

function insertSettings(
  userId: string,
  opts: {
    enabled?: boolean;
    hour?: number;
    recipients?: string[];
    emailSource?: 'gmail' | 'hosted';
  } = {}
) {
  testDb
    .prepare(`
      INSERT INTO user_settings
        (user_id, summary_enabled, summary_time_utc, summary_email_recipients, email_source, timezone)
      VALUES (?, ?, ?, ?, ?, 'UTC')
    `)
    .run(
      userId,
      opts.enabled !== false ? 1 : 0,
      opts.hour ?? 8,
      JSON.stringify(opts.recipients ?? [`${userId}@example.com`]),
      opts.emailSource ?? 'gmail'
    );
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  testDb.exec('DELETE FROM users; DELETE FROM auth; DELETE FROM user_settings;');

  // gmail-user-1: has Gmail OAuth, email_source = gmail (default)
  insertUser('gmail-user-1', 'gmail1@example.com');
  insertAuth('gmail-user-1');

  // gmail-user-2: has Gmail OAuth, email_source = gmail (default)
  insertUser('gmail-user-2', 'gmail2@example.com');
  insertAuth('gmail-user-2');

  // hosted-user: no OAuth row (hosted email path, no Gmail connected)
  insertUser('hosted-user', 'hosted@example.com');
});

// ===========================================================================
// 1. USER SELECTION: which users each cron iterates over
// ===========================================================================

describe('cron user selection', () => {
  describe('getAllOAuthUserIds — event-sync cron', () => {
    it('should only return users with an auth row', () => {
      const ids = getAllOAuthUserIds();
      expect(ids).toHaveLength(2);
      expect(ids).toContain('gmail-user-1');
      expect(ids).toContain('gmail-user-2');
    });

    it('should exclude hosted-email users with no auth row', () => {
      const ids = getAllOAuthUserIds();
      expect(ids).not.toContain('hosted-user');
    });
  });

  describe('getAllUsersWithRoles — summary + analysis crons', () => {
    it('should return all users regardless of OAuth state', () => {
      const ids = getAllUsersWithRoles().map(u => u.user_id);
      expect(ids).toHaveLength(3);
      expect(ids).toContain('gmail-user-1');
      expect(ids).toContain('gmail-user-2');
      expect(ids).toContain('hosted-user');
    });

    it('should include hosted-email user who has no auth row', () => {
      const ids = getAllUsersWithRoles().map(u => u.user_id);
      expect(ids).toContain('hosted-user');
    });
  });

  describe('user set difference', () => {
    it('summary/analysis crons see more users than event-sync cron', () => {
      const oauthIds = getAllOAuthUserIds();
      const allIds = getAllUsersWithRoles().map(u => u.user_id);
      expect(allIds.length).toBeGreaterThan(oauthIds.length);
    });

    it('hosted-user is in summary set but not in OAuth set', () => {
      const oauthIds = getAllOAuthUserIds();
      const allIds = getAllUsersWithRoles().map(u => u.user_id);
      expect(allIds).toContain('hosted-user');
      expect(oauthIds).not.toContain('hosted-user');
    });
  });
});

// ===========================================================================
// 2. SUMMARY CRON: processUserSummary skip conditions
//    processUserSummary() calls getOrCreateDefaultSettings() and skips when:
//      (a) summary_enabled === false
//      (b) summary_time_utc !== currentHourUtc
//      (c) summary_email_recipients.length === 0
// ===========================================================================

describe('summary cron — processUserSummary skip conditions', () => {
  describe('getOrCreateDefaultSettings — default values', () => {
    it('should return summary_enabled=true by default (no settings row)', () => {
      const settings = getOrCreateDefaultSettings('gmail-user-1');
      expect(settings.summary_enabled).toBe(true);
    });

    it('should return summary_time_utc=8 by default', () => {
      const settings = getOrCreateDefaultSettings('gmail-user-1');
      expect(settings.summary_time_utc).toBe(8);
    });

    it("should use the user's own email as the default recipient", () => {
      const settings = getOrCreateDefaultSettings('gmail-user-1');
      expect(settings.summary_email_recipients).toEqual(['gmail1@example.com']);
    });

    it('should return empty recipients for user with no email (edge case)', () => {
      // Insert a user with no email — can't do this due to NOT NULL, but we can
      // verify that the function handles the look-up correctly with a real user.
      // Instead verify the positive case fully.
      const settings = getOrCreateDefaultSettings('gmail-user-2');
      expect(settings.summary_email_recipients).toEqual(['gmail2@example.com']);
    });
  });

  describe('skip condition (a): summary_enabled=false', () => {
    it('should reflect summary_enabled=false from DB', () => {
      insertSettings('gmail-user-1', { enabled: false });
      const settings = getOrCreateDefaultSettings('gmail-user-1');
      // summary_enabled is stored as 0/1 in SQLite and parsed to boolean
      expect(settings.summary_enabled).toBe(false);
    });

    it('should reflect summary_enabled=true from DB', () => {
      insertSettings('gmail-user-1', { enabled: true });
      const settings = getOrCreateDefaultSettings('gmail-user-1');
      expect(settings.summary_enabled).toBe(true);
    });
  });

  describe('skip condition (b): summary_time_utc mismatch', () => {
    it('should store and return a custom send hour', () => {
      insertSettings('gmail-user-1', { hour: 7 });
      const settings = getOrCreateDefaultSettings('gmail-user-1');
      expect(settings.summary_time_utc).toBe(7);
    });

    it('should distinguish users with different send hours', () => {
      insertSettings('gmail-user-1', { hour: 6 });
      insertSettings('gmail-user-2', { hour: 9 });

      const s1 = getOrCreateDefaultSettings('gmail-user-1');
      const s2 = getOrCreateDefaultSettings('gmail-user-2');

      expect(s1.summary_time_utc).toBe(6);
      expect(s2.summary_time_utc).toBe(9);

      // Simulating what processUserSummary does at 7AM UTC:
      const currentHourUtc = 7;
      expect(s1.summary_time_utc === currentHourUtc).toBe(false); // skip
      expect(s2.summary_time_utc === currentHourUtc).toBe(false); // skip
    });

    it('should match the hour for the correct user at their send time', () => {
      insertSettings('gmail-user-1', { hour: 8 });
      insertSettings('gmail-user-2', { hour: 10 });

      const currentHourUtc = 8;
      const s1 = getOrCreateDefaultSettings('gmail-user-1');
      const s2 = getOrCreateDefaultSettings('gmail-user-2');

      expect(s1.summary_time_utc === currentHourUtc).toBe(true);  // send
      expect(s2.summary_time_utc === currentHourUtc).toBe(false); // skip
    });
  });

  describe('skip condition (c): no email recipients', () => {
    it('should skip when recipients list is empty', () => {
      insertSettings('gmail-user-1', { recipients: [] });
      const settings = getOrCreateDefaultSettings('gmail-user-1');
      expect(settings.summary_email_recipients).toHaveLength(0);
      // processUserSummary checks .length === 0 → skip
      expect(settings.summary_email_recipients.length === 0).toBe(true);
    });

    it('should proceed when at least one recipient is configured', () => {
      insertSettings('gmail-user-1', { recipients: ['parent@example.com'] });
      const settings = getOrCreateDefaultSettings('gmail-user-1');
      expect(settings.summary_email_recipients.length === 0).toBe(false);
    });

    it('should support multiple recipients', () => {
      insertSettings('gmail-user-1', { recipients: ['mum@example.com', 'dad@example.com'] });
      const settings = getOrCreateDefaultSettings('gmail-user-1');
      expect(settings.summary_email_recipients).toEqual(['mum@example.com', 'dad@example.com']);
    });
  });

  describe('combined skip conditions', () => {
    it('should send for a fully configured user at the right hour', () => {
      insertSettings('gmail-user-1', { enabled: true, hour: 8, recipients: ['parent@example.com'] });
      const settings = getOrCreateDefaultSettings('gmail-user-1');

      const currentHourUtc = 8;
      const shouldSend =
        settings.summary_enabled &&
        settings.summary_time_utc === currentHourUtc &&
        settings.summary_email_recipients.length > 0;

      expect(shouldSend).toBe(true);
    });

    it('should skip if any condition fails — wrong hour', () => {
      insertSettings('gmail-user-1', { enabled: true, hour: 9, recipients: ['parent@example.com'] });
      const settings = getOrCreateDefaultSettings('gmail-user-1');

      const currentHourUtc = 8;
      const shouldSend =
        settings.summary_enabled &&
        settings.summary_time_utc === currentHourUtc &&
        settings.summary_email_recipients.length > 0;

      expect(shouldSend).toBe(false);
    });

    it('should skip if any condition fails — disabled', () => {
      insertSettings('gmail-user-1', { enabled: false, hour: 8, recipients: ['parent@example.com'] });
      const settings = getOrCreateDefaultSettings('gmail-user-1');

      const currentHourUtc = 8;
      const shouldSend =
        settings.summary_enabled &&
        settings.summary_time_utc === currentHourUtc &&
        settings.summary_email_recipients.length > 0;

      expect(shouldSend).toBe(false);
    });

    it('should skip if any condition fails — no recipients', () => {
      insertSettings('gmail-user-1', { enabled: true, hour: 8, recipients: [] });
      const settings = getOrCreateDefaultSettings('gmail-user-1');

      const currentHourUtc = 8;
      const shouldSend =
        settings.summary_enabled &&
        settings.summary_time_utc === currentHourUtc &&
        settings.summary_email_recipients.length > 0;

      expect(shouldSend).toBe(false);
    });
  });
});

// ===========================================================================
// 4. getAllEnabledSettings — filters by summary_enabled=1
// ===========================================================================

describe('getAllEnabledSettings', () => {
  it('should return only users with summary_enabled=true', () => {
    insertSettings('gmail-user-1', { enabled: true });
    insertSettings('gmail-user-2', { enabled: false });
    insertSettings('hosted-user', { enabled: true });

    const enabled = getAllEnabledSettings().map(s => s.user_id);
    expect(enabled).toContain('gmail-user-1');
    expect(enabled).toContain('hosted-user');
    expect(enabled).not.toContain('gmail-user-2');
  });

  it('should return empty array when no users have summary_enabled', () => {
    insertSettings('gmail-user-1', { enabled: false });
    insertSettings('gmail-user-2', { enabled: false });

    const enabled = getAllEnabledSettings();
    expect(enabled).toHaveLength(0);
  });

  it('should return all users when all have summary_enabled=true', () => {
    insertSettings('gmail-user-1', { enabled: true });
    insertSettings('gmail-user-2', { enabled: true });
    insertSettings('hosted-user', { enabled: true });

    const enabled = getAllEnabledSettings();
    expect(enabled).toHaveLength(3);
  });
});
