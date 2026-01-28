// src/db/emailDb.ts

import db from './db.js';

/**
 * Email source type
 */
export type EmailSourceType = 'gmail' | 'hosted';

/**
 * Email stored in database
 */
export interface StoredEmail {
  id: number;
  user_id: string;
  gmail_message_id: string;
  gmail_thread_id?: string;
  from_email: string;
  from_name?: string;
  subject: string;
  date: Date;
  body_text?: string;
  snippet?: string;
  labels?: string[]; // Parsed from JSON
  has_attachments: boolean;
  attachment_content?: string;
  attachment_extraction_failed: boolean;
  processed: boolean;
  analyzed: boolean;
  gmail_labeled: boolean;
  fetch_error?: string;
  fetch_attempts: number;
  source_type: EmailSourceType;
  source_message_id?: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Input data for creating an email
 */
export interface CreateEmailInput {
  gmail_message_id: string;
  gmail_thread_id?: string;
  from_email: string;
  from_name?: string;
  subject: string;
  date: Date;
  body_text?: string;
  snippet?: string;
  labels?: string[];
  has_attachments?: boolean;
  attachment_content?: string;
  attachment_extraction_failed?: boolean;
  source_type?: EmailSourceType;
  source_message_id?: string;
}

/**
 * Prepared statements
 */

const insertStmt = db.prepare(`
  INSERT INTO emails (
    user_id, gmail_message_id, gmail_thread_id,
    from_email, from_name, subject, date,
    body_text, snippet, labels,
    has_attachments, attachment_content, attachment_extraction_failed,
    processed, analyzed, gmail_labeled,
    source_type, source_message_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)
`);

const getByIdStmt = db.prepare(`
  SELECT * FROM emails WHERE user_id = ? AND id = ?
`);

const getByGmailIdStmt = db.prepare(`
  SELECT * FROM emails WHERE user_id = ? AND gmail_message_id = ?
`);

const listEmailsStmt = db.prepare(`
  SELECT * FROM emails
  WHERE user_id = ?
  ORDER BY date DESC
  LIMIT ? OFFSET ?
`);

const listUnprocessedStmt = db.prepare(`
  SELECT * FROM emails
  WHERE user_id = ? AND processed = 0
  ORDER BY date DESC
`);

const listUnanalyzedStmt = db.prepare(`
  SELECT * FROM emails
  WHERE user_id = ? AND analyzed = 0 AND processed = 1
  ORDER BY date DESC
`);

const listUnlabeledStmt = db.prepare(`
  SELECT * FROM emails
  WHERE user_id = ? AND processed = 1 AND gmail_labeled = 0
  ORDER BY date DESC
`);

const markProcessedStmt = db.prepare(`
  UPDATE emails
  SET processed = 1, updated_at = CURRENT_TIMESTAMP
  WHERE user_id = ? AND id = ?
`);

const markAnalyzedStmt = db.prepare(`
  UPDATE emails
  SET analyzed = 1, updated_at = CURRENT_TIMESTAMP
  WHERE user_id = ? AND id = ?
`);

const markLabeledStmt = db.prepare(`
  UPDATE emails
  SET gmail_labeled = 1, updated_at = CURRENT_TIMESTAMP
  WHERE user_id = ? AND id = ?
`);

const recordErrorStmt = db.prepare(`
  UPDATE emails
  SET fetch_error = ?, fetch_attempts = fetch_attempts + 1, updated_at = CURRENT_TIMESTAMP
  WHERE user_id = ? AND gmail_message_id = ?
`);

const deleteStmt = db.prepare(`
  DELETE FROM emails WHERE user_id = ? AND id = ?
`);

const countStmt = db.prepare(`
  SELECT COUNT(*) as total FROM emails WHERE user_id = ?
`);

const countProcessedStmt = db.prepare(`
  SELECT COUNT(*) as total FROM emails WHERE user_id = ? AND processed = 1
`);

const countAnalyzedStmt = db.prepare(`
  SELECT COUNT(*) as total FROM emails WHERE user_id = ? AND analyzed = 1
`);

/**
 * Helper to parse email row from database
 */
function parseEmailRow(row: any): StoredEmail {
  return {
    id: row.id,
    user_id: row.user_id,
    gmail_message_id: row.gmail_message_id,
    gmail_thread_id: row.gmail_thread_id || undefined,
    from_email: row.from_email,
    from_name: row.from_name || undefined,
    subject: row.subject,
    date: new Date(row.date),
    body_text: row.body_text || undefined,
    snippet: row.snippet || undefined,
    labels: row.labels ? JSON.parse(row.labels) : undefined,
    has_attachments: Boolean(row.has_attachments),
    attachment_content: row.attachment_content || undefined,
    attachment_extraction_failed: Boolean(row.attachment_extraction_failed),
    processed: Boolean(row.processed),
    analyzed: Boolean(row.analyzed),
    gmail_labeled: Boolean(row.gmail_labeled),
    fetch_error: row.fetch_error || undefined,
    fetch_attempts: row.fetch_attempts,
    source_type: (row.source_type as EmailSourceType) || 'gmail',
    source_message_id: row.source_message_id || undefined,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

/**
 * Create a new email in the database
 *
 * @param userId - User ID
 * @param emailData - Email data
 * @returns Created email ID
 */
export function createEmail(userId: string, emailData: CreateEmailInput): number {
  // Determine source type and message ID
  const sourceType = emailData.source_type || 'gmail';
  const sourceMessageId = emailData.source_message_id || emailData.gmail_message_id;

  const result = insertStmt.run(
    userId,
    emailData.gmail_message_id,
    emailData.gmail_thread_id || null,
    emailData.from_email,
    emailData.from_name || null,
    emailData.subject,
    emailData.date.toISOString(),
    emailData.body_text || null,
    emailData.snippet || null,
    emailData.labels ? JSON.stringify(emailData.labels) : null,
    emailData.has_attachments ? 1 : 0,
    emailData.attachment_content || null,
    emailData.attachment_extraction_failed ? 1 : 0,
    sourceType,
    sourceMessageId
  );

  return result.lastInsertRowid as number;
}

/**
 * Get email by ID
 *
 * @param userId - User ID
 * @param emailId - Email ID
 * @returns Email or null
 */
export function getEmailById(userId: string, emailId: number): StoredEmail | null {
  const row = getByIdStmt.get(userId, emailId) as any;
  return row ? parseEmailRow(row) : null;
}

/**
 * Get email by Gmail message ID
 *
 * @param userId - User ID
 * @param gmailMessageId - Gmail message ID
 * @returns Email or null
 */
export function getEmailByGmailId(userId: string, gmailMessageId: string): StoredEmail | null {
  const row = getByGmailIdStmt.get(userId, gmailMessageId) as any;
  return row ? parseEmailRow(row) : null;
}

/**
 * List emails with pagination
 *
 * @param userId - User ID
 * @param limit - Number of emails to return
 * @param offset - Offset for pagination
 * @returns Array of emails
 */
export function listEmails(userId: string, limit: number = 50, offset: number = 0): StoredEmail[] {
  const rows = listEmailsStmt.all(userId, limit, offset) as any[];
  return rows.map(parseEmailRow);
}

/**
 * Get unprocessed emails (processed=false)
 *
 * @param userId - User ID
 * @returns Array of unprocessed emails
 */
export function getUnprocessedEmails(userId: string): StoredEmail[] {
  const rows = listUnprocessedStmt.all(userId) as any[];
  return rows.map(parseEmailRow);
}

/**
 * Get unanalyzed emails (processed=true, analyzed=false)
 *
 * @param userId - User ID
 * @returns Array of unanalyzed emails
 */
export function getUnanalyzedEmails(userId: string): StoredEmail[] {
  const rows = listUnanalyzedStmt.all(userId) as any[];
  return rows.map(parseEmailRow);
}

/**
 * Get unlabeled emails (processed=true, gmail_labeled=false)
 *
 * @param userId - User ID
 * @returns Array of unlabeled emails
 */
export function getUnlabeledEmails(userId: string): StoredEmail[] {
  const rows = listUnlabeledStmt.all(userId) as any[];
  return rows.map(parseEmailRow);
}

/**
 * Mark email as processed
 *
 * @param userId - User ID
 * @param emailId - Email ID
 */
export function markEmailProcessed(userId: string, emailId: number): void {
  markProcessedStmt.run(userId, emailId);
}

/**
 * Mark email as analyzed
 *
 * @param userId - User ID
 * @param emailId - Email ID
 */
export function markEmailAnalyzed(userId: string, emailId: number): void {
  markAnalyzedStmt.run(userId, emailId);
}

/**
 * Mark email as labeled in Gmail
 *
 * @param userId - User ID
 * @param emailId - Email ID
 */
export function markEmailLabeled(userId: string, emailId: number): void {
  markLabeledStmt.run(userId, emailId);
}

/**
 * Record fetch error for an email
 *
 * @param userId - User ID
 * @param gmailMessageId - Gmail message ID
 * @param error - Error message
 */
export function recordFetchError(userId: string, gmailMessageId: string, error: string): void {
  recordErrorStmt.run(error, userId, gmailMessageId);
}

/**
 * Delete email
 *
 * @param userId - User ID
 * @param emailId - Email ID
 * @returns true if deleted
 */
export function deleteEmail(userId: string, emailId: number): boolean {
  const result = deleteStmt.run(userId, emailId);
  return result.changes > 0;
}

/**
 * Get email statistics
 *
 * @param userId - User ID
 * @returns Statistics
 */
export function getEmailStats(userId: string): {
  total: number;
  processed: number;
  analyzed: number;
} {
  const totalRow = countStmt.get(userId) as any;
  const processedRow = countProcessedStmt.get(userId) as any;
  const analyzedRow = countAnalyzedStmt.get(userId) as any;

  return {
    total: totalRow?.total || 0,
    processed: processedRow?.total || 0,
    analyzed: analyzedRow?.total || 0,
  };
}

/**
 * Check if email exists by Gmail message ID
 *
 * @param userId - User ID
 * @param gmailMessageId - Gmail message ID
 * @returns true if exists
 */
export function emailExists(userId: string, gmailMessageId: string): boolean {
  return getEmailByGmailId(userId, gmailMessageId) !== null;
}

// ============================================
// SOURCE-BASED EMAIL FUNCTIONS
// ============================================

const getBySourceIdStmt = db.prepare(`
  SELECT * FROM emails
  WHERE user_id = ? AND source_type = ? AND source_message_id = ?
`);

const listBySourceStmt = db.prepare(`
  SELECT * FROM emails
  WHERE user_id = ? AND source_type = ?
  ORDER BY date DESC
  LIMIT ? OFFSET ?
`);

const countBySourceStmt = db.prepare(`
  SELECT COUNT(*) as total FROM emails WHERE user_id = ? AND source_type = ?
`);

/**
 * Get email by source type and source message ID
 * Used for deduplication when receiving hosted emails
 *
 * @param userId - User ID
 * @param sourceType - Source type ('gmail' or 'hosted')
 * @param sourceMessageId - Source-specific message ID
 * @returns Email or null
 */
export function getEmailBySourceId(
  userId: string,
  sourceType: EmailSourceType,
  sourceMessageId: string
): StoredEmail | null {
  const row = getBySourceIdStmt.get(userId, sourceType, sourceMessageId) as any;
  return row ? parseEmailRow(row) : null;
}

/**
 * Check if email exists by source type and message ID
 *
 * @param userId - User ID
 * @param sourceType - Source type
 * @param sourceMessageId - Source message ID
 * @returns true if exists
 */
export function emailExistsBySource(
  userId: string,
  sourceType: EmailSourceType,
  sourceMessageId: string
): boolean {
  return getEmailBySourceId(userId, sourceType, sourceMessageId) !== null;
}

/**
 * List emails by source type with pagination
 *
 * @param userId - User ID
 * @param sourceType - Source type to filter by
 * @param limit - Number of emails to return
 * @param offset - Offset for pagination
 * @returns Array of emails
 */
export function listEmailsBySource(
  userId: string,
  sourceType: EmailSourceType,
  limit: number = 50,
  offset: number = 0
): StoredEmail[] {
  const rows = listBySourceStmt.all(userId, sourceType, limit, offset) as any[];
  return rows.map(parseEmailRow);
}

/**
 * Count emails by source type
 *
 * @param userId - User ID
 * @param sourceType - Source type to count
 * @returns Count of emails
 */
export function countEmailsBySource(userId: string, sourceType: EmailSourceType): number {
  const row = countBySourceStmt.get(userId, sourceType) as { total: number };
  return row?.total || 0;
}
