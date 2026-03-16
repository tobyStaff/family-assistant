// src/plugins/dailySummary.test.ts
//
// Tests that the summary and analysis crons use getAllUsersWithRoles() (users table)
// and the fetch/event-sync crons use getAllOAuthUserIds() (auth table).
// This guards against the bug where hosted-email users were excluded from
// the summary loop because they have no row in the auth table.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// Must mock db before any module that imports it
vi.mock('../db/db.js', () => {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');

  testDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      picture_url TEXT,
      roles TEXT DEFAULT '["STANDARD"]',
      hosted_email_alias TEXT,
      onboarding_step INTEGER DEFAULT 0,
      gmail_connected BOOLEAN DEFAULT 0,
      calendar_connected BOOLEAN DEFAULT 0,
      gmail_forwarding_confirmation_url TEXT DEFAULT NULL,
      trial_started_at TEXT DEFAULT NULL,
      email_suppressed INTEGER DEFAULT 0,
      email_suppressed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS auth (
      user_id TEXT PRIMARY KEY,
      refresh_token TEXT,
      access_token TEXT,
      expiry_date INTEGER
    );
  `);

  return { default: testDb };
});

import { getAllOAuthUserIds } from '../db/authDb.js';
import { getAllUsersWithRoles } from '../db/userDb.js';
import db from '../db/db.js';

const testDb = db as Database.Database;

// Seed helpers
function insertUser(userId: string, email: string) {
  testDb.prepare('INSERT INTO users (user_id, email) VALUES (?, ?)').run(userId, email);
}

function insertAuth(userId: string) {
  testDb
    .prepare('INSERT INTO auth (user_id, refresh_token, access_token, expiry_date) VALUES (?, ?, ?, ?)')
    .run(userId, 'refresh', 'access', Date.now() + 3600_000);
}

describe('dailySummary cron user selection', () => {
  beforeEach(() => {
    testDb.exec('DELETE FROM users; DELETE FROM auth;');

    // gmail-user-1: has Gmail OAuth
    insertUser('gmail-user-1', 'gmail1@example.com');
    insertAuth('gmail-user-1');

    // gmail-user-2: has Gmail OAuth
    insertUser('gmail-user-2', 'gmail2@example.com');
    insertAuth('gmail-user-2');

    // hosted-user: no OAuth row (hosted email, never connected Gmail)
    insertUser('hosted-user', 'hosted@example.com');
  });

  describe('getAllOAuthUserIds (fetch + event-sync crons)', () => {
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

  describe('getAllUsersWithRoles (summary + analysis crons)', () => {
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

  describe('user selection difference', () => {
    it('summary/analysis crons see more users than fetch/event-sync crons', () => {
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
