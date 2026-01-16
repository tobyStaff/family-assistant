// src/db/processedDb.ts
import db from './db.js';

/**
 * Prepared statements for processed emails operations
 * Used for idempotency to prevent duplicate processing
 */

// Check if an email has been processed
const checkStmt = db.prepare(`
  SELECT 1 FROM processed_emails
  WHERE email_id = ? AND user_id = ?
`);

/**
 * Check if an email has already been processed
 *
 * @param userId - User ID
 * @param emailId - Gmail message ID
 * @returns true if already processed, false otherwise
 */
export function isProcessed(userId: string, emailId: string): boolean {
  return !!checkStmt.get(emailId, userId);
}

// Insert processed email record
const insertStmt = db.prepare(`
  INSERT INTO processed_emails (email_id, user_id)
  VALUES (?, ?)
`);

/**
 * Mark an email as processed
 *
 * @param userId - User ID
 * @param emailId - Gmail message ID
 */
export function markProcessed(userId: string, emailId: string): void {
  insertStmt.run(emailId, userId);
}

/**
 * Get all processed emails for a user (for debugging/admin)
 *
 * @param userId - User ID
 * @returns Array of processed email records
 */
const listStmt = db.prepare(`
  SELECT email_id, processed_at, ROWID
  FROM processed_emails
  WHERE user_id = ?
  ORDER BY processed_at DESC, ROWID DESC
`);

export function listProcessed(userId: string): Array<{ email_id: string; processed_at: Date }> {
  const rows = listStmt.all(userId) as any[];
  return rows.map(row => ({
    email_id: row.email_id,
    processed_at: new Date(row.processed_at),
  }));
}
