// src/db/authDb.ts
import db from './db.js';
import type { AuthEntry } from '../types/todo.js';

/**
 * Prepared statements for auth operations
 * Tokens should be encrypted before storing (use crypto module from deliverable 1)
 */

// UPSERT statement for storing auth tokens
// Uses INSERT OR REPLACE since user_id is primary key
const upsertStmt = db.prepare(`
  INSERT OR REPLACE INTO auth (user_id, refresh_token, access_token, expiry_date)
  VALUES (?, ?, ?, ?)
`);

// SELECT statement for retrieving auth tokens
const getStmt = db.prepare(`
  SELECT * FROM auth WHERE user_id = ?
`);

// DELETE statement for removing auth tokens
const deleteStmt = db.prepare(`
  DELETE FROM auth WHERE user_id = ?
`);

// SELECT statement for getting all user IDs
const getAllUserIdsStmt = db.prepare(`
  SELECT user_id FROM auth
`);

/**
 * Store or update auth tokens for a user
 * IMPORTANT: Tokens should be encrypted before calling this function
 *
 * @param entry - Auth entry with encrypted tokens
 */
export function storeAuth(entry: AuthEntry): void {
  upsertStmt.run(
    entry.user_id,
    entry.refresh_token, // Should be encrypted
    entry.access_token || null,
    entry.expiry_date ? entry.expiry_date.toISOString() : null
  );
}

/**
 * Get auth tokens for a user
 * IMPORTANT: Tokens will be encrypted and need to be decrypted after retrieval
 *
 * @param userId - User ID
 * @returns Auth entry if found, null otherwise
 */
export function getAuth(userId: string): AuthEntry | null {
  const row = getStmt.get(userId) as any;
  if (!row) return null;

  const auth: AuthEntry = {
    user_id: row.user_id,
    refresh_token: row.refresh_token,
  };

  if (row.access_token) {
    auth.access_token = row.access_token;
  }

  if (row.expiry_date) {
    auth.expiry_date = new Date(row.expiry_date);
  }

  return auth;
}

/**
 * Delete auth tokens for a user
 * Useful for logout or token revocation
 *
 * @param userId - User ID
 * @returns true if deleted, false if not found
 */
export function deleteAuth(userId: string): boolean {
  const result = deleteStmt.run(userId);
  return result.changes > 0;
}

/**
 * Check if auth tokens exist for a user
 *
 * @param userId - User ID
 * @returns true if auth exists, false otherwise
 */
export function hasAuth(userId: string): boolean {
  return getAuth(userId) !== null;
}

/**
 * Update only the access token for a user
 * Useful for token refresh without updating refresh token
 *
 * @param userId - User ID
 * @param accessToken - New access token (encrypted)
 * @param expiryDate - New expiry date
 * @returns true if updated, false if user not found
 */
export function updateAccessToken(
  userId: string,
  accessToken: string,
  expiryDate?: Date
): boolean {
  const existing = getAuth(userId);
  if (!existing) return false;

  const updatedAuth: AuthEntry = {
    user_id: userId,
    refresh_token: existing.refresh_token,
    access_token: accessToken,
  };

  if (expiryDate) {
    updatedAuth.expiry_date = expiryDate;
  }

  storeAuth(updatedAuth);

  return true;
}

/**
 * Get all user IDs with stored auth
 * Used for daily summary cron job to process all users
 *
 * @returns Array of user IDs
 */
export function getAllUserIds(): string[] {
  const rows = getAllUserIdsStmt.all() as any[];
  return rows.map(row => row.user_id);
}

/**
 * Get user's OAuth2 client
 * Fetches encrypted tokens from database and creates OAuth2Client
 *
 * @param userId - User ID
 * @returns OAuth2Client with tokens
 */
export async function getUserAuth(userId: string): Promise<any> {
  const { google } = await import('googleapis');
  const { decrypt } = await import('../lib/crypto.js');

  // Fetch encrypted tokens from database
  const authEntry = getAuth(userId);
  if (!authEntry) {
    throw new Error(`No auth found for user ${userId}`);
  }

  // Decrypt tokens (stored as "iv:content")
  const decryptToken = (encryptedData: string): string => {
    const [iv, content] = encryptedData.split(':');
    if (!iv || !content) {
      throw new Error('Invalid encrypted token format');
    }
    return decrypt(content, iv);
  };

  const refreshToken = decryptToken(authEntry.refresh_token);
  const accessToken = authEntry.access_token
    ? decryptToken(authEntry.access_token)
    : undefined;

  // Create OAuth2Client
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
    access_token: accessToken ?? null,
    expiry_date: authEntry.expiry_date?.getTime() ?? null,
  });

  return oauth2Client;
}
