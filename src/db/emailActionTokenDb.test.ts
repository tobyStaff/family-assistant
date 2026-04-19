// src/db/emailActionTokenDb.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

vi.mock('./db.js', () => {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');

  testDb.exec(`
    CREATE TABLE IF NOT EXISTS email_action_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      action_type TEXT NOT NULL CHECK(action_type IN ('complete_todo', 'remove_event', 'view_summary')),
      target_id INTEGER,
      expires_at DATETIME NOT NULL,
      used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_action_tokens_token ON email_action_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_action_tokens_expires ON email_action_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_action_tokens_user ON email_action_tokens(user_id);
  `);

  return { default: testDb };
});

import {
  createActionToken,
  createViewToken,
  validateAndUseToken,
  validateTokenReadOnly,
  getTokenInfo,
} from './emailActionTokenDb.js';
import db from './db.js';

const testDb = db as unknown as Database.Database;

describe('emailActionTokenDb', () => {
  beforeEach(() => {
    testDb.exec('DELETE FROM email_action_tokens');
  });

  describe('createViewToken', () => {
    it('creates a view_summary token with null target_id', () => {
      const token = createViewToken('user-1');
      const info = getTokenInfo(token);
      expect(info).not.toBeNull();
      expect(info!.action_type).toBe('view_summary');
      expect(info!.user_id).toBe('user-1');
      expect(info!.target_id).toBeNull();
    });

    it('sets expiry 7 days from now by default', () => {
      const token = createViewToken('user-1');
      const info = getTokenInfo(token);
      const days = (info!.expires_at.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThan(7.1);
    });
  });

  describe('validateTokenReadOnly', () => {
    it('returns valid result for a fresh view token', () => {
      const token = createViewToken('user-1');
      const result = validateTokenReadOnly(token);
      expect(result.valid).toBe(true);
      expect(result.userId).toBe('user-1');
      expect(result.actionType).toBe('view_summary');
    });

    it('does NOT mark the token as used', () => {
      const token = createViewToken('user-1');
      validateTokenReadOnly(token);
      const info = getTokenInfo(token);
      expect(info!.used_at).toBeNull();
    });

    it('returns valid on repeated reads', () => {
      const token = createViewToken('user-1');
      const r1 = validateTokenReadOnly(token);
      const r2 = validateTokenReadOnly(token);
      const r3 = validateTokenReadOnly(token);
      expect(r1.valid).toBe(true);
      expect(r2.valid).toBe(true);
      expect(r3.valid).toBe(true);
    });

    it('rejects unknown tokens', () => {
      const result = validateTokenReadOnly('does-not-exist');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token not found');
    });

    it('rejects expired tokens', () => {
      const pastExpiry = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      testDb.prepare(`
        INSERT INTO email_action_tokens (token, user_id, action_type, target_id, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('expired-token', 'user-1', 'view_summary', null, pastExpiry);

      const result = validateTokenReadOnly('expired-token');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token has expired');
    });

    it('still returns valid for a used one-shot token (read-only does not care about used_at)', () => {
      const token = createActionToken('user-1', 'complete_todo', 99);
      validateAndUseToken(token); // consume
      const result = validateTokenReadOnly(token);
      // Read-only variant ignores used_at — forwardable links remain readable.
      expect(result.valid).toBe(true);
      expect(result.actionType).toBe('complete_todo');
    });
  });

  describe('validateAndUseToken (regression)', () => {
    it('still marks one-shot tokens as used', () => {
      const token = createActionToken('user-1', 'complete_todo', 42);
      const first = validateAndUseToken(token);
      expect(first.valid).toBe(true);

      const info = getTokenInfo(token);
      expect(info!.used_at).not.toBeNull();

      const second = validateAndUseToken(token);
      expect(second.valid).toBe(false);
      expect(second.error).toBe('Token has already been used');
    });

    it('accepts view_summary tokens but does not prevent re-validation via read-only path', () => {
      const token = createViewToken('user-1');
      // Not used via validateAndUseToken in production, but exercise read-only path.
      const r1 = validateTokenReadOnly(token);
      const r2 = validateTokenReadOnly(token);
      expect(r1.valid).toBe(true);
      expect(r2.valid).toBe(true);
    });
  });
});
