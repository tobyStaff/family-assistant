// src/db/relevanceFeedbackDb.ts

import db from './db.js';

export interface RelevanceFeedbackItem {
  id?: number;
  user_id: string;
  item_type: 'todo' | 'event';
  item_text: string;
  source_sender?: string;
  source_subject?: string;
  is_relevant?: number | null; // null = ungraded, 1 = relevant, 0 = not relevant
  created_at?: string;
  updated_at?: string;
}

/**
 * Insert multiple feedback items (for onboarding extraction)
 */
type FeedbackItemInput = Omit<RelevanceFeedbackItem, 'id' | 'created_at' | 'updated_at'>;

export function insertFeedbackItemsBatch(items: FeedbackItemInput[]): number[] {
  const stmt = db.prepare(`
    INSERT INTO relevance_feedback (user_id, item_type, item_text, source_sender, source_subject, is_relevant)
    VALUES (?, ?, ?, ?, ?, NULL)
  `);

  const ids: number[] = [];
  const insertMany = db.transaction((feedbackItems: FeedbackItemInput[]) => {
    for (const item of feedbackItems) {
      const result = stmt.run(item.user_id, item.item_type, item.item_text, item.source_sender || null, item.source_subject || null);
      ids.push(result.lastInsertRowid as number);
    }
  });

  insertMany(items);
  return ids;
}

/**
 * Get all feedback items for a user
 */
export function getFeedbackItems(userId: string): RelevanceFeedbackItem[] {
  const stmt = db.prepare(`
    SELECT * FROM relevance_feedback
    WHERE user_id = ?
    ORDER BY created_at DESC
  `);
  return stmt.all(userId) as RelevanceFeedbackItem[];
}

/**
 * Get ungraded feedback items for a user
 */
export function getUngradedFeedbackItems(userId: string): RelevanceFeedbackItem[] {
  const stmt = db.prepare(`
    SELECT * FROM relevance_feedback
    WHERE user_id = ? AND is_relevant IS NULL
    ORDER BY created_at DESC
  `);
  return stmt.all(userId) as RelevanceFeedbackItem[];
}

/**
 * Update the relevance grade for a feedback item
 */
export function updateFeedbackGrade(userId: string, itemId: number, isRelevant: boolean): boolean {
  const stmt = db.prepare(`
    UPDATE relevance_feedback
    SET is_relevant = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `);
  const result = stmt.run(isRelevant ? 1 : 0, itemId, userId);
  return result.changes > 0;
}

/**
 * Batch update relevance grades
 */
export function updateFeedbackGradesBatch(userId: string, grades: { id: number; isRelevant: boolean }[]): number {
  const stmt = db.prepare(`
    UPDATE relevance_feedback
    SET is_relevant = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `);

  let updated = 0;
  const updateMany = db.transaction((grades: { id: number; isRelevant: boolean }[]) => {
    for (const grade of grades) {
      const result = stmt.run(grade.isRelevant ? 1 : 0, grade.id, userId);
      updated += result.changes;
    }
  });

  updateMany(grades);
  return updated;
}

/**
 * Delete a feedback item
 */
export function deleteFeedbackItem(userId: string, itemId: number): boolean {
  const stmt = db.prepare(`DELETE FROM relevance_feedback WHERE id = ? AND user_id = ?`);
  const result = stmt.run(itemId, userId);
  return result.changes > 0;
}

/**
 * Clear all feedback items for a user (for re-onboarding)
 */
export function clearFeedbackItems(userId: string): number {
  const stmt = db.prepare(`DELETE FROM relevance_feedback WHERE user_id = ?`);
  const result = stmt.run(userId);
  return result.changes;
}

/**
 * Check if user has any feedback items
 */
export function hasFeedbackItems(userId: string): boolean {
  const stmt = db.prepare(`SELECT 1 FROM relevance_feedback WHERE user_id = ? LIMIT 1`);
  return stmt.get(userId) !== undefined;
}

/**
 * Few-shot example structure for prompts
 */
export interface FewShotExample {
  item_type: 'todo' | 'event';
  item_text: string;
  source_sender?: string;
}

/**
 * Get graded feedback items suitable for few-shot prompting.
 * Returns examples split by relevance for injection into AI prompts.
 */
export function getGradedExamplesForPrompt(
  userId: string,
  limitPerCategory: number = 3
): { relevant: FewShotExample[]; notRelevant: FewShotExample[] } {
  // Get most recent relevant examples
  const relevantStmt = db.prepare(`
    SELECT item_type, item_text, source_sender
    FROM relevance_feedback
    WHERE user_id = ? AND is_relevant = 1
    ORDER BY updated_at DESC
    LIMIT ?
  `);
  const relevant = relevantStmt.all(userId, limitPerCategory) as FewShotExample[];

  // Get most recent not-relevant examples
  const notRelevantStmt = db.prepare(`
    SELECT item_type, item_text, source_sender
    FROM relevance_feedback
    WHERE user_id = ? AND is_relevant = 0
    ORDER BY updated_at DESC
    LIMIT ?
  `);
  const notRelevant = notRelevantStmt.all(userId, limitPerCategory) as FewShotExample[];

  return { relevant, notRelevant };
}

/**
 * Get feedback statistics for a user
 */
export function getFeedbackStats(userId: string): { total: number; relevant: number; notRelevant: number; ungraded: number } {
  const stmt = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN is_relevant = 1 THEN 1 ELSE 0 END) as relevant,
      SUM(CASE WHEN is_relevant = 0 THEN 1 ELSE 0 END) as notRelevant,
      SUM(CASE WHEN is_relevant IS NULL THEN 1 ELSE 0 END) as ungraded
    FROM relevance_feedback
    WHERE user_id = ?
  `);
  const result = stmt.get(userId) as { total: number; relevant: number; notRelevant: number; ungraded: number } | undefined;
  return result || { total: 0, relevant: 0, notRelevant: 0, ungraded: 0 };
}
