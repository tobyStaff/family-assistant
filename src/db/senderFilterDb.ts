// src/db/senderFilterDb.ts
import db from './db.js';

export interface SenderFilter {
  id?: number;
  user_id: string;
  sender_email: string;
  sender_name?: string;
  status: 'include' | 'exclude';
  created_at?: string;
  // Scoring fields from migration 14
  relevance_score?: number | null;
  relevant_count?: number;
  not_relevant_count?: number;
  last_score_update?: string | null;
}

// Prepared statements
const getFiltersStmt = db.prepare(`
  SELECT * FROM sender_filters WHERE user_id = ? ORDER BY sender_email
`);

const getIncludedSendersStmt = db.prepare(`
  SELECT sender_email FROM sender_filters WHERE user_id = ? AND status = 'include'
`);

const upsertFilterStmt = db.prepare(`
  INSERT INTO sender_filters (user_id, sender_email, sender_name, status)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(user_id, sender_email) DO UPDATE SET
    sender_name = excluded.sender_name,
    status = excluded.status
`);

const deleteFilterStmt = db.prepare(`
  DELETE FROM sender_filters WHERE user_id = ? AND sender_email = ?
`);

const deleteAllFiltersStmt = db.prepare(`
  DELETE FROM sender_filters WHERE user_id = ?
`);

const countFiltersStmt = db.prepare(`
  SELECT COUNT(*) as count FROM sender_filters WHERE user_id = ? AND status = ?
`);

/**
 * Get all sender filters for a user
 */
export function getSenderFilters(userId: string): SenderFilter[] {
  return getFiltersStmt.all(userId) as SenderFilter[];
}

/**
 * Get list of included sender emails for a user
 */
export function getIncludedSenders(userId: string): string[] {
  const rows = getIncludedSendersStmt.all(userId) as { sender_email: string }[];
  return rows.map((r) => r.sender_email);
}

/**
 * Upsert a sender filter (insert or update status)
 */
export function upsertSenderFilter(filter: SenderFilter): void {
  upsertFilterStmt.run(filter.user_id, filter.sender_email, filter.sender_name || null, filter.status);
}

/**
 * Batch upsert sender filters
 */
export function upsertSenderFiltersBatch(filters: SenderFilter[]): void {
  const transaction = db.transaction(() => {
    for (const filter of filters) {
      upsertFilterStmt.run(filter.user_id, filter.sender_email, filter.sender_name || null, filter.status);
    }
  });
  transaction();
}

/**
 * Delete a sender filter
 */
export function deleteSenderFilter(userId: string, senderEmail: string): boolean {
  const result = deleteFilterStmt.run(userId, senderEmail);
  return result.changes > 0;
}

/**
 * Delete all sender filters for a user
 */
export function deleteAllSenderFilters(userId: string): number {
  const result = deleteAllFiltersStmt.run(userId);
  return result.changes;
}

/**
 * Count filters by status
 */
export function countSenderFilters(userId: string, status: 'include' | 'exclude'): number {
  const row = countFiltersStmt.get(userId, status) as { count: number };
  return row.count;
}

/**
 * Check if a user has any sender filters configured
 */
export function hasSenderFilters(userId: string): boolean {
  return countSenderFilters(userId, 'include') > 0;
}

/**
 * Update sender filter with scoring data
 */
export function updateSenderFilterScore(
  userId: string,
  senderEmail: string,
  relevantCount: number,
  notRelevantCount: number,
  relevanceScore: number
): boolean {
  const stmt = db.prepare(`
    UPDATE sender_filters
    SET relevance_score = ?,
        relevant_count = ?,
        not_relevant_count = ?,
        last_score_update = CURRENT_TIMESTAMP
    WHERE user_id = ? AND sender_email = ?
  `);
  const result = stmt.run(relevanceScore, relevantCount, notRelevantCount, userId, senderEmail);
  return result.changes > 0;
}

/**
 * Get senders with low relevance scores (for warnings)
 */
export function getLowScoreSenders(userId: string, threshold: number = 0.3): SenderFilter[] {
  const stmt = db.prepare(`
    SELECT * FROM sender_filters
    WHERE user_id = ? AND status = 'include' AND relevance_score IS NOT NULL AND relevance_score < ?
    ORDER BY relevance_score ASC
  `);
  return stmt.all(userId, threshold) as SenderFilter[];
}
