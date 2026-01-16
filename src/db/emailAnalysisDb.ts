// src/db/emailAnalysisDb.ts

import db from './db.js';
import type { HumanAnalysis } from '../types/extraction.js';

/**
 * Analysis status types
 */
export type AnalysisStatus = 'pending' | 'analyzed' | 'reviewed' | 'approved' | 'rejected';

/**
 * Stored email analysis record
 */
export interface StoredEmailAnalysis {
  id: number;
  user_id: string;
  email_id: number;
  analysis_version: number;
  ai_provider: string;
  email_summary: string | null;
  email_tone: string | null;
  email_intent: string | null;
  implicit_context: string | null;
  raw_extraction_json: string | null;
  quality_score: number | null;
  confidence_avg: number | null;
  events_extracted: number;
  todos_extracted: number;
  recurring_items: number;
  inferred_items: number;
  status: AnalysisStatus;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  review_notes: string | null;
  analysis_error: string | null;
  retry_count: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Input for creating an email analysis
 */
export interface CreateEmailAnalysisInput {
  email_id: number;
  ai_provider: 'openai' | 'anthropic';
  human_analysis?: HumanAnalysis;
  raw_extraction_json?: string;
  quality_score?: number;
  confidence_avg?: number;
  events_extracted?: number;
  todos_extracted?: number;
  recurring_items?: number;
  inferred_items?: number;
  analysis_error?: string;
}

/**
 * Create a new email analysis record
 */
export function createEmailAnalysis(
  userId: string,
  input: CreateEmailAnalysisInput
): number {
  
  const stmt = db.prepare(`
    INSERT INTO email_analyses (
      user_id,
      email_id,
      ai_provider,
      email_summary,
      email_tone,
      email_intent,
      implicit_context,
      raw_extraction_json,
      quality_score,
      confidence_avg,
      events_extracted,
      todos_extracted,
      recurring_items,
      inferred_items,
      status,
      analysis_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    userId,
    input.email_id,
    input.ai_provider,
    input.human_analysis?.email_summary || null,
    input.human_analysis?.email_tone || null,
    input.human_analysis?.email_intent || null,
    input.human_analysis?.implicit_context || null,
    input.raw_extraction_json || null,
    input.quality_score || null,
    input.confidence_avg || null,
    input.events_extracted || 0,
    input.todos_extracted || 0,
    input.recurring_items || 0,
    input.inferred_items || 0,
    input.analysis_error ? 'pending' : 'analyzed',
    input.analysis_error || null
  );

  return result.lastInsertRowid as number;
}

/**
 * Get analysis by ID
 */
export function getEmailAnalysisById(
  userId: string,
  analysisId: number
): StoredEmailAnalysis | null {
  
  const stmt = db.prepare(`
    SELECT * FROM email_analyses
    WHERE user_id = ? AND id = ?
  `);

  const row = stmt.get(userId, analysisId) as any;
  if (!row) return null;

  return formatAnalysisRow(row);
}

/**
 * Get analysis by email ID
 */
export function getAnalysisByEmailId(
  userId: string,
  emailId: number
): StoredEmailAnalysis | null {
  
  const stmt = db.prepare(`
    SELECT * FROM email_analyses
    WHERE user_id = ? AND email_id = ?
    ORDER BY analysis_version DESC
    LIMIT 1
  `);

  const row = stmt.get(userId, emailId) as any;
  if (!row) return null;

  return formatAnalysisRow(row);
}

/**
 * List all analyses for a user
 */
export function listEmailAnalyses(
  userId: string,
  limit: number = 50,
  offset: number = 0,
  status?: AnalysisStatus
): StoredEmailAnalysis[] {
  
  let sql = `
    SELECT * FROM email_analyses
    WHERE user_id = ?
  `;
  const params: any[] = [userId];

  if (status) {
    sql += ` AND status = ?`;
    params.push(status);
  }

  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as any[];

  return rows.map(formatAnalysisRow);
}

/**
 * Get unanalyzed email IDs (emails without analysis)
 */
export function getUnanalyzedEmailIds(userId: string, limit: number = 100): number[] {
  
  const stmt = db.prepare(`
    SELECT e.id
    FROM emails e
    LEFT JOIN email_analyses ea ON e.id = ea.email_id AND e.user_id = ea.user_id
    WHERE e.user_id = ? AND e.processed = 1 AND ea.id IS NULL
    ORDER BY e.date DESC
    LIMIT ?
  `);

  const rows = stmt.all(userId, limit) as { id: number }[];
  return rows.map((r) => r.id);
}

/**
 * Update analysis status
 */
export function updateAnalysisStatus(
  userId: string,
  analysisId: number,
  status: AnalysisStatus,
  reviewedBy?: string,
  reviewNotes?: string
): boolean {
  
  const stmt = db.prepare(`
    UPDATE email_analyses
    SET status = ?,
        reviewed_by = ?,
        reviewed_at = CASE WHEN ? IS NOT NULL THEN CURRENT_TIMESTAMP ELSE reviewed_at END,
        review_notes = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND id = ?
  `);

  const result = stmt.run(
    status,
    reviewedBy || null,
    reviewedBy || null,
    reviewNotes || null,
    userId,
    analysisId
  );

  return result.changes > 0;
}

/**
 * Update analysis with error
 */
export function recordAnalysisError(
  userId: string,
  analysisId: number,
  error: string
): boolean {
  
  const stmt = db.prepare(`
    UPDATE email_analyses
    SET analysis_error = ?,
        retry_count = retry_count + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND id = ?
  `);

  const result = stmt.run(error, userId, analysisId);
  return result.changes > 0;
}

/**
 * Get analysis statistics for a user
 */
export function getAnalysisStats(userId: string): {
  total: number;
  pending: number;
  analyzed: number;
  reviewed: number;
  approved: number;
  rejected: number;
  avgQualityScore: number | null;
  avgConfidence: number | null;
  totalEvents: number;
  totalTodos: number;
  totalRecurring: number;
  totalInferred: number;
} {
  
  const stmt = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'analyzed' THEN 1 ELSE 0 END) as analyzed,
      SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END) as reviewed,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
      AVG(quality_score) as avg_quality_score,
      AVG(confidence_avg) as avg_confidence,
      SUM(events_extracted) as total_events,
      SUM(todos_extracted) as total_todos,
      SUM(recurring_items) as total_recurring,
      SUM(inferred_items) as total_inferred
    FROM email_analyses
    WHERE user_id = ?
  `);

  const row = stmt.get(userId) as any;

  return {
    total: row.total || 0,
    pending: row.pending || 0,
    analyzed: row.analyzed || 0,
    reviewed: row.reviewed || 0,
    approved: row.approved || 0,
    rejected: row.rejected || 0,
    avgQualityScore: row.avg_quality_score,
    avgConfidence: row.avg_confidence,
    totalEvents: row.total_events || 0,
    totalTodos: row.total_todos || 0,
    totalRecurring: row.total_recurring || 0,
    totalInferred: row.total_inferred || 0,
  };
}

/**
 * Delete an analysis
 */
export function deleteEmailAnalysis(userId: string, analysisId: number): boolean {
  
  const stmt = db.prepare(`
    DELETE FROM email_analyses
    WHERE user_id = ? AND id = ?
  `);

  const result = stmt.run(userId, analysisId);
  return result.changes > 0;
}

/**
 * Get analyses pending review (quality score below threshold)
 */
export function getAnalysesPendingReview(
  userId: string,
  qualityThreshold: number = 0.7,
  limit: number = 50
): StoredEmailAnalysis[] {
  
  const stmt = db.prepare(`
    SELECT * FROM email_analyses
    WHERE user_id = ?
      AND status = 'analyzed'
      AND (quality_score IS NULL OR quality_score < ?)
    ORDER BY quality_score ASC, created_at DESC
    LIMIT ?
  `);

  const rows = stmt.all(userId, qualityThreshold, limit) as any[];
  return rows.map(formatAnalysisRow);
}

/**
 * Batch approve analyses
 */
export function batchApproveAnalyses(
  userId: string,
  analysisIds: number[],
  reviewedBy: string
): number {
  
  const stmt = db.prepare(`
    UPDATE email_analyses
    SET status = 'approved',
        reviewed_by = ?,
        reviewed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND id = ? AND status IN ('analyzed', 'reviewed')
  `);

  let count = 0;
  for (const id of analysisIds) {
    const result = stmt.run(reviewedBy, userId, id);
    if (result.changes > 0) count++;
  }

  return count;
}

/**
 * Format database row to StoredEmailAnalysis
 */
function formatAnalysisRow(row: any): StoredEmailAnalysis {
  return {
    id: row.id,
    user_id: row.user_id,
    email_id: row.email_id,
    analysis_version: row.analysis_version,
    ai_provider: row.ai_provider,
    email_summary: row.email_summary,
    email_tone: row.email_tone,
    email_intent: row.email_intent,
    implicit_context: row.implicit_context,
    raw_extraction_json: row.raw_extraction_json,
    quality_score: row.quality_score,
    confidence_avg: row.confidence_avg,
    events_extracted: row.events_extracted,
    todos_extracted: row.todos_extracted,
    recurring_items: row.recurring_items,
    inferred_items: row.inferred_items,
    status: row.status as AnalysisStatus,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at ? new Date(row.reviewed_at) : null,
    review_notes: row.review_notes,
    analysis_error: row.analysis_error,
    retry_count: row.retry_count,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}
