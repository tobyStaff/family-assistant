// src/db/authDb.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// Mock the db import with a factory function
vi.mock('./db.js', () => {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');

  // Create tables for testing
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS auth (
      user_id TEXT PRIMARY KEY,
      refresh_token TEXT NOT NULL,
      access_token TEXT,
      expiry_date DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_auth_user_id ON auth(user_id);
  `);

  return {
    default: testDb,
  };
});

// Import functions after mocking
import {
  storeAuth,
  getAuth,
  deleteAuth,
  hasAuth,
  updateAccessToken,
} from './authDb.js';
import db from './db.js';

const testDb = db as Database.Database;

describe('authDb', () => {
  beforeEach(() => {
    // Clear auth table before each test
    testDb.exec('DELETE FROM auth');
  });

  describe('storeAuth', () => {
    it('should store new auth entry', () => {
      storeAuth({
        user_id: 'user1',
        refresh_token: 'encrypted_refresh_token',
        access_token: 'encrypted_access_token',
        expiry_date: new Date('2026-01-15T10:00:00Z'),
      });

      const auth = getAuth('user1');
      expect(auth).toBeDefined();
      expect(auth?.user_id).toBe('user1');
      expect(auth?.refresh_token).toBe('encrypted_refresh_token');
      expect(auth?.access_token).toBe('encrypted_access_token');
    });

    it('should update existing auth entry (upsert)', () => {
      // Store initial auth
      storeAuth({
        user_id: 'user1',
        refresh_token: 'old_refresh_token',
      });

      // Update with new tokens
      storeAuth({
        user_id: 'user1',
        refresh_token: 'new_refresh_token',
        access_token: 'new_access_token',
      });

      const auth = getAuth('user1');
      expect(auth?.refresh_token).toBe('new_refresh_token');
      expect(auth?.access_token).toBe('new_access_token');
    });

    it('should handle auth without access token', () => {
      storeAuth({
        user_id: 'user1',
        refresh_token: 'refresh_only',
      });

      const auth = getAuth('user1');
      expect(auth?.refresh_token).toBe('refresh_only');
      expect(auth?.access_token).toBeUndefined();
    });

    it('should handle auth without expiry date', () => {
      storeAuth({
        user_id: 'user1',
        refresh_token: 'no_expiry_refresh',
        access_token: 'no_expiry_access',
      });

      const auth = getAuth('user1');
      expect(auth?.expiry_date).toBeUndefined();
    });
  });

  describe('getAuth', () => {
    it('should retrieve stored auth', () => {
      const expiryDate = new Date('2026-02-01T10:00:00Z');
      storeAuth({
        user_id: 'user1',
        refresh_token: 'test_refresh',
        access_token: 'test_access',
        expiry_date: expiryDate,
      });

      const auth = getAuth('user1');
      expect(auth).toBeDefined();
      expect(auth?.user_id).toBe('user1');
      expect(auth?.refresh_token).toBe('test_refresh');
      expect(auth?.access_token).toBe('test_access');
      expect(auth?.expiry_date).toBeInstanceOf(Date);
      expect(auth?.expiry_date?.toISOString()).toBe(expiryDate.toISOString());
    });

    it('should return null for non-existent user', () => {
      const auth = getAuth('nonexistent');
      expect(auth).toBeNull();
    });

    it('should handle optional fields correctly', () => {
      storeAuth({
        user_id: 'user1',
        refresh_token: 'only_refresh',
      });

      const auth = getAuth('user1');
      expect(auth?.access_token).toBeUndefined();
      expect(auth?.expiry_date).toBeUndefined();
    });
  });

  describe('deleteAuth', () => {
    it('should delete auth entry', () => {
      storeAuth({
        user_id: 'user1',
        refresh_token: 'to_delete',
      });

      const success = deleteAuth('user1');
      expect(success).toBe(true);

      const auth = getAuth('user1');
      expect(auth).toBeNull();
    });

    it('should return false for non-existent user', () => {
      const success = deleteAuth('nonexistent');
      expect(success).toBe(false);
    });
  });

  describe('hasAuth', () => {
    it('should return true when auth exists', () => {
      storeAuth({
        user_id: 'user1',
        refresh_token: 'test',
      });

      expect(hasAuth('user1')).toBe(true);
    });

    it('should return false when auth does not exist', () => {
      expect(hasAuth('nonexistent')).toBe(false);
    });
  });

  describe('updateAccessToken', () => {
    it('should update access token', () => {
      storeAuth({
        user_id: 'user1',
        refresh_token: 'refresh',
        access_token: 'old_access',
      });

      const success = updateAccessToken('user1', 'new_access');
      expect(success).toBe(true);

      const auth = getAuth('user1');
      expect(auth?.access_token).toBe('new_access');
      expect(auth?.refresh_token).toBe('refresh'); // Unchanged
    });

    it('should update access token with expiry', () => {
      storeAuth({
        user_id: 'user1',
        refresh_token: 'refresh',
      });

      const newExpiry = new Date('2026-03-01T10:00:00Z');
      const success = updateAccessToken('user1', 'new_access', newExpiry);
      expect(success).toBe(true);

      const auth = getAuth('user1');
      expect(auth?.access_token).toBe('new_access');
      expect(auth?.expiry_date).toBeInstanceOf(Date);
      expect(auth?.expiry_date?.toISOString()).toBe(newExpiry.toISOString());
    });

    it('should return false for non-existent user', () => {
      const success = updateAccessToken('nonexistent', 'new_access');
      expect(success).toBe(false);
    });
  });

  describe('multi-user isolation', () => {
    it('should keep auth separate for different users', () => {
      storeAuth({
        user_id: 'user1',
        refresh_token: 'user1_refresh',
        access_token: 'user1_access',
      });

      storeAuth({
        user_id: 'user2',
        refresh_token: 'user2_refresh',
        access_token: 'user2_access',
      });

      const auth1 = getAuth('user1');
      const auth2 = getAuth('user2');

      expect(auth1?.refresh_token).toBe('user1_refresh');
      expect(auth1?.access_token).toBe('user1_access');

      expect(auth2?.refresh_token).toBe('user2_refresh');
      expect(auth2?.access_token).toBe('user2_access');
    });

    it('should only delete targeted user auth', () => {
      storeAuth({
        user_id: 'user1',
        refresh_token: 'user1_refresh',
      });

      storeAuth({
        user_id: 'user2',
        refresh_token: 'user2_refresh',
      });

      deleteAuth('user1');

      expect(hasAuth('user1')).toBe(false);
      expect(hasAuth('user2')).toBe(true);
    });
  });

  describe('date handling', () => {
    it('should correctly store and retrieve dates', () => {
      const expiryDate = new Date('2026-12-31T23:59:59Z');
      storeAuth({
        user_id: 'user1',
        refresh_token: 'test',
        expiry_date: expiryDate,
      });

      const auth = getAuth('user1');
      expect(auth?.expiry_date).toBeInstanceOf(Date);
      expect(auth?.expiry_date?.getTime()).toBe(expiryDate.getTime());
    });

    it('should handle undefined expiry date', () => {
      storeAuth({
        user_id: 'user1',
        refresh_token: 'test',
      });

      const auth = getAuth('user1');
      expect(auth?.expiry_date).toBeUndefined();
    });
  });
});
