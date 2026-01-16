// src/db/sessionDb.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// Mock the db import with a factory function
vi.mock('./db.js', () => {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');

  // Create tables for testing
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      picture_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);

  return {
    default: testDb,
  };
});

// Import functions after mocking
import {
  createSession,
  getSession,
  deleteSession,
  deleteUserSessions,
  cleanupExpiredSessions,
  hasValidSession,
} from './sessionDb.js';
import db from './db.js';

const testDb = db as Database.Database;

describe('sessionDb', () => {
  beforeEach(() => {
    // Clear tables before each test
    testDb.exec('DELETE FROM sessions');
    testDb.exec('DELETE FROM users');

    // Insert a test user for foreign key constraints
    testDb.prepare('INSERT INTO users (user_id, email) VALUES (?, ?)').run('user1', 'user1@example.com');
    testDb.prepare('INSERT INTO users (user_id, email) VALUES (?, ?)').run('user2', 'user2@example.com');
  });

  describe('createSession', () => {
    it('should create a new session and return session ID', () => {
      const expiresAt = new Date(Date.now() + 86400000); // 1 day from now
      const sessionId = createSession('user1', expiresAt);

      expect(sessionId).toBeDefined();
      expect(sessionId).toHaveLength(64); // 32 bytes hex = 64 chars
      expect(typeof sessionId).toBe('string');
    });

    it('should generate unique session IDs', () => {
      const expiresAt = new Date(Date.now() + 86400000);
      const sessionId1 = createSession('user1', expiresAt);
      const sessionId2 = createSession('user1', expiresAt);

      expect(sessionId1).not.toBe(sessionId2);
    });

    it('should store session with correct expiry date', () => {
      const expiresAt = new Date('2026-12-31T23:59:59Z');
      const sessionId = createSession('user1', expiresAt);

      const session = getSession(sessionId);
      expect(session).toBeDefined();
      expect(session?.user_id).toBe('user1');
    });
  });

  describe('getSession', () => {
    it('should retrieve valid session', () => {
      const expiresAt = new Date(Date.now() + 86400000);
      const sessionId = createSession('user1', expiresAt);

      const session = getSession(sessionId);
      expect(session).toBeDefined();
      expect(session?.user_id).toBe('user1');
    });

    it('should return null for non-existent session', () => {
      const session = getSession('invalid_session_id');
      expect(session).toBeNull();
    });

    it('should return null for expired session', () => {
      const expiresAt = new Date(Date.now() - 1000); // Expired 1 second ago
      const sessionId = createSession('user1', expiresAt);

      const session = getSession(sessionId);
      expect(session).toBeNull();
    });

    it('should delete expired session automatically', () => {
      const expiresAt = new Date(Date.now() - 1000);
      const sessionId = createSession('user1', expiresAt);

      // First call returns null and deletes
      getSession(sessionId);

      // Verify session is deleted from database
      const row = testDb.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId);
      expect(row).toBeUndefined();
    });
  });

  describe('deleteSession', () => {
    it('should delete existing session', () => {
      const expiresAt = new Date(Date.now() + 86400000);
      const sessionId = createSession('user1', expiresAt);

      const deleted = deleteSession(sessionId);
      expect(deleted).toBe(true);

      const session = getSession(sessionId);
      expect(session).toBeNull();
    });

    it('should return false for non-existent session', () => {
      const deleted = deleteSession('invalid_session_id');
      expect(deleted).toBe(false);
    });
  });

  describe('deleteUserSessions', () => {
    it('should delete all sessions for a user', () => {
      const expiresAt = new Date(Date.now() + 86400000);

      // Create multiple sessions for user1
      const session1 = createSession('user1', expiresAt);
      const session2 = createSession('user1', expiresAt);
      const session3 = createSession('user2', expiresAt);

      const deleted = deleteUserSessions('user1');
      expect(deleted).toBe(2);

      // Verify user1 sessions are deleted
      expect(getSession(session1)).toBeNull();
      expect(getSession(session2)).toBeNull();

      // Verify user2 session still exists
      expect(getSession(session3)).toBeDefined();
    });

    it('should return 0 for user with no sessions', () => {
      const deleted = deleteUserSessions('user1');
      expect(deleted).toBe(0);
    });
  });

  describe('cleanupExpiredSessions', () => {
    it('should delete all expired sessions', () => {
      const futureDate = new Date(Date.now() + 86400000);
      const pastDate = new Date(Date.now() - 1000);

      // Create expired and valid sessions
      createSession('user1', pastDate);
      createSession('user1', pastDate);
      const validSession = createSession('user2', futureDate);

      const deleted = cleanupExpiredSessions();
      expect(deleted).toBe(2);

      // Verify valid session still exists
      expect(getSession(validSession)).toBeDefined();
    });

    it('should return 0 when no expired sessions', () => {
      const futureDate = new Date(Date.now() + 86400000);
      createSession('user1', futureDate);
      createSession('user2', futureDate);

      const deleted = cleanupExpiredSessions();
      expect(deleted).toBe(0);
    });
  });

  describe('hasValidSession', () => {
    it('should return true for valid session', () => {
      const expiresAt = new Date(Date.now() + 86400000);
      const sessionId = createSession('user1', expiresAt);

      expect(hasValidSession(sessionId)).toBe(true);
    });

    it('should return false for expired session', () => {
      const expiresAt = new Date(Date.now() - 1000);
      const sessionId = createSession('user1', expiresAt);

      expect(hasValidSession(sessionId)).toBe(false);
    });

    it('should return false for non-existent session', () => {
      expect(hasValidSession('invalid_session_id')).toBe(false);
    });
  });

  describe('cascade delete', () => {
    it('should delete sessions when user is deleted', () => {
      const expiresAt = new Date(Date.now() + 86400000);
      const sessionId = createSession('user1', expiresAt);

      // Delete user (should cascade to sessions)
      testDb.prepare('DELETE FROM users WHERE user_id = ?').run('user1');

      // Verify session is gone
      const row = testDb.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId);
      expect(row).toBeUndefined();
    });
  });
});
