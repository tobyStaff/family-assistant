// src/db/processedEmailsDb.ts

import db from './db.js';

/**
 * Prepared statements for processed emails tracking
 */

// Check if email has been processed
const checkStmt = db.prepare(`
  SELECT 1 FROM processed_emails
  WHERE user_id = ? AND email_id = ?
  LIMIT 1
`);

// Insert processed email record
const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO processed_emails (user_id, email_id)
  VALUES (?, ?)
`);

// Get count of processed emails for user
const countStmt = db.prepare(`
  SELECT COUNT(*) as count FROM processed_emails
  WHERE user_id = ?
`);

// Get most recent processed timestamp
const lastProcessedStmt = db.prepare(`
  SELECT MAX(processed_at) as last_processed
  FROM processed_emails
  WHERE user_id = ?
`);

// Delete processed email record (for re-processing)
const deleteStmt = db.prepare(`
  DELETE FROM processed_emails
  WHERE user_id = ? AND email_id = ?
`);

/**
 * Check if an email has already been processed
 *
 * @param userId - User ID
 * @param emailId - Email ID from Gmail
 * @returns true if email was already processed
 */
export function isEmailProcessed(userId: string, emailId: string): boolean {
  const result = checkStmt.get(userId, emailId);
  return result !== undefined;
}

/**
 * Mark an email as processed
 *
 * @param userId - User ID
 * @param emailId - Email ID from Gmail
 * @returns true if inserted, false if already existed
 */
export function markEmailAsProcessed(userId: string, emailId: string): boolean {
  const result = insertStmt.run(userId, emailId);
  return result.changes > 0;
}

/**
 * Get count of processed emails for user
 *
 * @param userId - User ID
 * @returns Number of emails processed
 */
export function getProcessedEmailCount(userId: string): number {
  const result = countStmt.get(userId) as { count: number };
  return result.count;
}

/**
 * Get timestamp of last processed email
 *
 * @param userId - User ID
 * @returns Date of last processed email, or null if none
 */
export function getLastProcessedTimestamp(userId: string): Date | null {
  const result = lastProcessedStmt.get(userId) as { last_processed: string | null };
  return result.last_processed ? new Date(result.last_processed) : null;
}

/**
 * Remove processed email record (to allow re-processing)
 *
 * @param userId - User ID
 * @param emailId - Email ID from Gmail
 * @returns true if deleted, false if didn't exist
 */
export function unmarkEmailAsProcessed(userId: string, emailId: string): boolean {
  const result = deleteStmt.run(userId, emailId);
  return result.changes > 0;
}

/**
 * Batch mark emails as processed
 *
 * @param userId - User ID
 * @param emailIds - Array of email IDs
 * @returns Number of emails marked
 */
export function markEmailsAsProcessedBatch(userId: string, emailIds: string[]): number {
  let count = 0;
  const transaction = db.transaction(() => {
    for (const emailId of emailIds) {
      if (markEmailAsProcessed(userId, emailId)) {
        count++;
      }
    }
  });
  transaction();
  return count;
}

/**
 * Get processing statistics for user
 *
 * @param userId - User ID
 * @returns Processing stats
 */
export function getProcessingStats(userId: string): {
  total_processed: number;
  last_processed_at: Date | null;
} {
  return {
    total_processed: getProcessedEmailCount(userId),
    last_processed_at: getLastProcessedTimestamp(userId),
  };
}
