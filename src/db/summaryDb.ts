// src/db/summaryDb.ts
import db from './db.js';
import type { EmailSummaryRecord } from '../types/summary.js';

/**
 * Prepared statements for email summary operations
 */
const insertSummaryStmt = db.prepare(`
  INSERT INTO email_summaries (
    user_id,
    summary_date,
    inbox_count,
    summary_json,
    sent_at
  ) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(user_id, summary_date) DO UPDATE SET
    inbox_count = excluded.inbox_count,
    summary_json = excluded.summary_json,
    sent_at = excluded.sent_at
`);

const getSummaryByDateStmt = db.prepare(`
  SELECT 
    id,
    user_id,
    summary_date,
    inbox_count,
    summary_json,
    sent_at
  FROM email_summaries
  WHERE user_id = ? AND summary_date = ?
`);

const getSummariesByUserStmt = db.prepare(`
  SELECT 
    id,
    user_id,
    summary_date,
    inbox_count,
    summary_json,
    sent_at
  FROM email_summaries
  WHERE user_id = ?
  ORDER BY summary_date DESC
  LIMIT ?
`);

const deleteSummaryStmt = db.prepare(`
  DELETE FROM email_summaries WHERE id = ?
`);

/**
 * Parse database row to EmailSummaryRecord
 */
function parseRow(row: any): EmailSummaryRecord {
  return {
    id: row.id,
    user_id: row.user_id,
    summary_date: new Date(row.summary_date),
    inbox_count: row.inbox_count,
    summary_json: row.summary_json,
    sent_at: row.sent_at ? new Date(row.sent_at) : undefined,
  };
}

/**
 * Save email summary to database
 *
 * @param summary - Email summary record
 */
export function saveSummary(summary: Omit<EmailSummaryRecord, 'id'>): void {
  insertSummaryStmt.run(
    summary.user_id,
    summary.summary_date.toISOString().split('T')[0], // YYYY-MM-DD
    summary.inbox_count,
    summary.summary_json,
    summary.sent_at ? summary.sent_at.toISOString() : null
  );
}

/**
 * Get email summary for a specific date
 *
 * @param userId - User ID
 * @param date - Summary date
 * @returns Email summary or null if not found
 */
export function getSummaryByDate(userId: string, date: Date): EmailSummaryRecord | null {
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  const row = getSummaryByDateStmt.get(userId, dateStr) as any;
  return row ? parseRow(row) : null;
}

/**
 * Get recent email summaries for a user
 *
 * @param userId - User ID
 * @param limit - Maximum number of summaries to return (default: 30)
 * @returns Array of email summaries
 */
export function getRecentSummaries(userId: string, limit: number = 30): EmailSummaryRecord[] {
  const rows = getSummariesByUserStmt.all(userId, limit) as any[];
  return rows.map(parseRow);
}

/**
 * Delete an email summary
 *
 * @param summaryId - Summary ID
 * @returns True if summary was deleted
 */
export function deleteSummary(summaryId: number): boolean {
  const result = deleteSummaryStmt.run(summaryId);
  return result.changes > 0;
}
