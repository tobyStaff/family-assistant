// src/db/sessionDb.ts
import db from './db.js';
import { randomBytes } from 'crypto';

/**
 * Prepared statements for session operations
 */

// INSERT statement for creating a new session
const insertStmt = db.prepare(`
  INSERT INTO sessions (session_id, user_id, expires_at)
  VALUES (?, ?, ?)
`);

// SELECT statement for retrieving a session
const getStmt = db.prepare(`
  SELECT * FROM sessions WHERE session_id = ?
`);

// DELETE statement for removing a session
const deleteStmt = db.prepare(`
  DELETE FROM sessions WHERE session_id = ?
`);

// DELETE statement for removing all sessions for a user
const deleteUserSessionsStmt = db.prepare(`
  DELETE FROM sessions WHERE user_id = ?
`);

// DELETE statement for removing expired sessions
const cleanupExpiredStmt = db.prepare(`
  DELETE FROM sessions WHERE datetime(expires_at) < datetime('now')
`);

/**
 * Create a new session for a user
 *
 * @param userId - User ID
 * @param expiresAt - Session expiration date
 * @returns Generated session ID
 */
export function createSession(userId: string, expiresAt: Date): string {
  // Generate cryptographically secure random session ID
  const sessionId = randomBytes(32).toString('hex');

  insertStmt.run(sessionId, userId, expiresAt.toISOString());

  return sessionId;
}

/**
 * Get session by ID and validate expiration
 *
 * @param sessionId - Session ID
 * @returns Session data if valid and not expired, null otherwise
 */
export function getSession(sessionId: string): { user_id: string } | null {
  const row = getStmt.get(sessionId) as any;
  if (!row) return null;

  // Check if session is expired
  const expiresAt = new Date(row.expires_at);
  if (expiresAt < new Date()) {
    // Session expired, delete it
    deleteStmt.run(sessionId);
    return null;
  }

  return {
    user_id: row.user_id,
  };
}

/**
 * Delete a session (logout)
 *
 * @param sessionId - Session ID
 * @returns true if deleted, false if not found
 */
export function deleteSession(sessionId: string): boolean {
  const result = deleteStmt.run(sessionId);
  return result.changes > 0;
}

/**
 * Delete all sessions for a user (logout from all devices)
 *
 * @param userId - User ID
 * @returns Number of sessions deleted
 */
export function deleteUserSessions(userId: string): number {
  const result = deleteUserSessionsStmt.run(userId);
  return result.changes;
}

/**
 * Clean up expired sessions
 * Should be called periodically (e.g., daily cron job)
 *
 * @returns Number of expired sessions deleted
 */
export function cleanupExpiredSessions(): number {
  const result = cleanupExpiredStmt.run();
  return result.changes;
}

/**
 * Check if a session exists and is valid
 *
 * @param sessionId - Session ID
 * @returns true if session exists and is valid, false otherwise
 */
export function hasValidSession(sessionId: string): boolean {
  return getSession(sessionId) !== null;
}
