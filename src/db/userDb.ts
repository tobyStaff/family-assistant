// src/db/userDb.ts
import db from './db.js';
import type { UserProfile } from '../types/todo.js';

/**
 * Prepared statements for user operations
 */

// UPSERT statement for storing user profile
// Uses INSERT OR REPLACE since user_id is primary key
const upsertStmt = db.prepare(`
  INSERT INTO users (user_id, email, name, picture_url, updated_at)
  VALUES (?, ?, ?, ?, datetime('now'))
  ON CONFLICT(user_id) DO UPDATE SET
    email = excluded.email,
    name = excluded.name,
    picture_url = excluded.picture_url,
    updated_at = datetime('now')
`);

// SELECT statement for retrieving user by ID
const getByIdStmt = db.prepare(`
  SELECT * FROM users WHERE user_id = ?
`);

// SELECT statement for retrieving user by email
const getByEmailStmt = db.prepare(`
  SELECT * FROM users WHERE email = ?
`);

// DELETE statement for removing a user
const deleteStmt = db.prepare(`
  DELETE FROM users WHERE user_id = ?
`);

// UPDATE statement for partial updates
const updateStmt = db.prepare(`
  UPDATE users
  SET email = ?, name = ?, picture_url = ?, updated_at = datetime('now')
  WHERE user_id = ?
`);

/**
 * Upsert user profile (insert or update)
 * Called after successful OAuth to store/update Google profile
 *
 * @param user - User profile from Google OAuth
 */
export function upsertUser(user: UserProfile): void {
  upsertStmt.run(
    user.user_id,
    user.email,
    user.name || null,
    user.picture_url || null
  );
}

/**
 * Get user profile by user ID
 *
 * @param userId - User ID
 * @returns User profile if found, null otherwise
 */
export function getUser(userId: string): UserProfile | null {
  const row = getByIdStmt.get(userId) as any;
  if (!row) return null;

  return rowToUserProfile(row);
}

/**
 * Get user profile by email address
 * Useful for login/lookup scenarios
 *
 * @param email - Email address
 * @returns User profile if found, null otherwise
 */
export function getUserByEmail(email: string): UserProfile | null {
  const row = getByEmailStmt.get(email) as any;
  if (!row) return null;

  return rowToUserProfile(row);
}

/**
 * Update user profile
 * Use for partial updates after upsert
 * Note: Passing undefined for a field will clear it (set to null)
 *
 * @param userId - User ID
 * @param updates - Partial user profile with fields to update
 * @returns true if updated, false if user not found
 */
export function updateUser(
  userId: string,
  updates: Partial<UserProfile>
): boolean {
  // Get existing user to merge updates
  const existing = getUser(userId);
  if (!existing) return false;

  // For each field, use the update value if provided, otherwise keep existing
  // Note: 'email' in updates checks if the key exists, not if the value is truthy
  const updatedUser: UserProfile = {
    user_id: userId,
    email: 'email' in updates ? updates.email! : existing.email,
    name: 'name' in updates ? updates.name : existing.name,
    picture_url: 'picture_url' in updates ? updates.picture_url : existing.picture_url,
  };

  updateStmt.run(
    updatedUser.email,
    updatedUser.name || null,
    updatedUser.picture_url || null,
    userId
  );

  return true;
}

/**
 * Delete user profile
 * Note: This will cascade delete sessions and auth due to foreign keys
 *
 * @param userId - User ID
 * @returns true if deleted, false if not found
 */
export function deleteUser(userId: string): boolean {
  const result = deleteStmt.run(userId);
  return result.changes > 0;
}

/**
 * Check if user exists
 *
 * @param userId - User ID
 * @returns true if user exists, false otherwise
 */
export function hasUser(userId: string): boolean {
  return getUser(userId) !== null;
}

/**
 * Helper function to convert database row to UserProfile
 *
 * @param row - Database row
 * @returns UserProfile object
 */
function rowToUserProfile(row: any): UserProfile {
  return {
    user_id: row.user_id,
    email: row.email,
    name: row.name || undefined,
    picture_url: row.picture_url || undefined,
    created_at: row.created_at ? new Date(row.created_at) : undefined,
    updated_at: row.updated_at ? new Date(row.updated_at) : undefined,
  };
}
