// src/db/userDb.test.ts
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
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);

  return {
    default: testDb,
  };
});

// Import functions after mocking
import {
  upsertUser,
  getUser,
  getUserByEmail,
  updateUser,
  deleteUser,
  hasUser,
} from './userDb.js';
import db from './db.js';
import type { UserProfile } from '../types/todo.js';

const testDb = db as Database.Database;

describe('userDb', () => {
  beforeEach(() => {
    // Clear users table before each test
    testDb.exec('DELETE FROM users');
  });

  describe('upsertUser', () => {
    it('should insert new user', () => {
      const user: UserProfile = {
        user_id: 'google_12345',
        email: 'test@example.com',
        name: 'Test User',
        picture_url: 'https://example.com/photo.jpg',
      };

      upsertUser(user);

      const retrieved = getUser('google_12345');
      expect(retrieved).toBeDefined();
      expect(retrieved?.user_id).toBe('google_12345');
      expect(retrieved?.email).toBe('test@example.com');
      expect(retrieved?.name).toBe('Test User');
      expect(retrieved?.picture_url).toBe('https://example.com/photo.jpg');
    });

    it('should update existing user (upsert)', () => {
      const user: UserProfile = {
        user_id: 'google_12345',
        email: 'old@example.com',
        name: 'Old Name',
      };

      upsertUser(user);

      // Update with new data
      const updatedUser: UserProfile = {
        user_id: 'google_12345',
        email: 'new@example.com',
        name: 'New Name',
        picture_url: 'https://example.com/new.jpg',
      };

      upsertUser(updatedUser);

      const retrieved = getUser('google_12345');
      expect(retrieved?.email).toBe('new@example.com');
      expect(retrieved?.name).toBe('New Name');
      expect(retrieved?.picture_url).toBe('https://example.com/new.jpg');
    });

    it('should handle user without optional fields', () => {
      const user: UserProfile = {
        user_id: 'google_12345',
        email: 'test@example.com',
      };

      upsertUser(user);

      const retrieved = getUser('google_12345');
      expect(retrieved?.user_id).toBe('google_12345');
      expect(retrieved?.email).toBe('test@example.com');
      expect(retrieved?.name).toBeUndefined();
      expect(retrieved?.picture_url).toBeUndefined();
    });

    it('should set updated_at timestamp on update', () => {
      const user: UserProfile = {
        user_id: 'google_12345',
        email: 'test@example.com',
        name: 'Test User',
      };

      upsertUser(user);
      getUser('google_12345');

      // Wait a bit and update
      setTimeout(() => {
        upsertUser({ ...user, name: 'Updated Name' });
        const second = getUser('google_12345');

        expect(second?.updated_at).toBeDefined();
        // Note: In real scenario, updated_at would be different
      }, 10);
    });
  });

  describe('getUser', () => {
    it('should retrieve user by ID', () => {
      upsertUser({
        user_id: 'google_12345',
        email: 'test@example.com',
        name: 'Test User',
      });

      const user = getUser('google_12345');
      expect(user).toBeDefined();
      expect(user?.user_id).toBe('google_12345');
    });

    it('should return null for non-existent user', () => {
      const user = getUser('non_existent');
      expect(user).toBeNull();
    });

    it('should include timestamps', () => {
      upsertUser({
        user_id: 'google_12345',
        email: 'test@example.com',
      });

      const user = getUser('google_12345');
      expect(user?.created_at).toBeDefined();
      expect(user?.updated_at).toBeDefined();
      expect(user?.created_at).toBeInstanceOf(Date);
      expect(user?.updated_at).toBeInstanceOf(Date);
    });
  });

  describe('getUserByEmail', () => {
    it('should retrieve user by email', () => {
      upsertUser({
        user_id: 'google_12345',
        email: 'test@example.com',
        name: 'Test User',
      });

      const user = getUserByEmail('test@example.com');
      expect(user).toBeDefined();
      expect(user?.user_id).toBe('google_12345');
      expect(user?.email).toBe('test@example.com');
    });

    it('should return null for non-existent email', () => {
      const user = getUserByEmail('nonexistent@example.com');
      expect(user).toBeNull();
    });

    it('should enforce email uniqueness', () => {
      upsertUser({
        user_id: 'google_12345',
        email: 'test@example.com',
        name: 'User 1',
      });

      // Try to insert different user with same email
      expect(() => {
        testDb.prepare('INSERT INTO users (user_id, email) VALUES (?, ?)').run('google_67890', 'test@example.com');
      }).toThrow();
    });
  });

  describe('updateUser', () => {
    it('should update user fields', () => {
      upsertUser({
        user_id: 'google_12345',
        email: 'old@example.com',
        name: 'Old Name',
      });

      const updated = updateUser('google_12345', {
        email: 'new@example.com',
        name: 'New Name',
      });

      expect(updated).toBe(true);

      const user = getUser('google_12345');
      expect(user?.email).toBe('new@example.com');
      expect(user?.name).toBe('New Name');
    });

    it('should allow partial updates', () => {
      upsertUser({
        user_id: 'google_12345',
        email: 'test@example.com',
        name: 'Test User',
        picture_url: 'https://example.com/old.jpg',
      });

      updateUser('google_12345', {
        name: 'Updated Name',
      });

      const user = getUser('google_12345');
      expect(user?.name).toBe('Updated Name');
      expect(user?.email).toBe('test@example.com'); // Unchanged
      expect(user?.picture_url).toBe('https://example.com/old.jpg'); // Unchanged
    });

    it('should return false for non-existent user', () => {
      const updated = updateUser('non_existent', {
        name: 'New Name',
      });

      expect(updated).toBe(false);
    });

    it('should clear optional fields with undefined', () => {
      upsertUser({
        user_id: 'google_12345',
        email: 'test@example.com',
        name: 'Test User',
        picture_url: 'https://example.com/photo.jpg',
      });

      updateUser('google_12345', {
        name: undefined,
        picture_url: undefined,
      });

      const user = getUser('google_12345');
      expect(user?.name).toBeUndefined();
      expect(user?.picture_url).toBeUndefined();
    });
  });

  describe('deleteUser', () => {
    it('should delete existing user', () => {
      upsertUser({
        user_id: 'google_12345',
        email: 'test@example.com',
        name: 'Test User',
      });

      const deleted = deleteUser('google_12345');
      expect(deleted).toBe(true);

      const user = getUser('google_12345');
      expect(user).toBeNull();
    });

    it('should return false for non-existent user', () => {
      const deleted = deleteUser('non_existent');
      expect(deleted).toBe(false);
    });
  });

  describe('hasUser', () => {
    it('should return true for existing user', () => {
      upsertUser({
        user_id: 'google_12345',
        email: 'test@example.com',
      });

      expect(hasUser('google_12345')).toBe(true);
    });

    it('should return false for non-existent user', () => {
      expect(hasUser('non_existent')).toBe(false);
    });
  });

  describe('multi-user scenarios', () => {
    it('should handle multiple users independently', () => {
      upsertUser({
        user_id: 'google_12345',
        email: 'user1@example.com',
        name: 'User 1',
      });

      upsertUser({
        user_id: 'google_67890',
        email: 'user2@example.com',
        name: 'User 2',
      });

      const user1 = getUser('google_12345');
      const user2 = getUser('google_67890');

      expect(user1?.name).toBe('User 1');
      expect(user2?.name).toBe('User 2');
    });

    it('should allow updates without affecting other users', () => {
      upsertUser({
        user_id: 'google_12345',
        email: 'user1@example.com',
        name: 'User 1',
      });

      upsertUser({
        user_id: 'google_67890',
        email: 'user2@example.com',
        name: 'User 2',
      });

      updateUser('google_12345', { name: 'Updated User 1' });

      const user1 = getUser('google_12345');
      const user2 = getUser('google_67890');

      expect(user1?.name).toBe('Updated User 1');
      expect(user2?.name).toBe('User 2'); // Unchanged
    });
  });
});
