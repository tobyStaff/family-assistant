// src/db/attachmentDb.ts

import db from './db.js';

/**
 * Attachment stored in database
 */
export interface StoredAttachment {
  id: number;
  email_id: number;
  filename: string;
  mime_type?: string;
  size?: number;
  storage_path: string;
  extraction_status: 'pending' | 'success' | 'failed' | 'skipped';
  extraction_error?: string;
  extracted_text?: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Input data for creating an attachment record
 */
export interface CreateAttachmentInput {
  email_id: number;
  filename: string;
  mime_type?: string;
  size?: number;
  storage_path: string;
  extraction_status?: 'pending' | 'success' | 'failed' | 'skipped';
  extraction_error?: string;
  extracted_text?: string;
}

/**
 * Prepared statements
 */

const insertStmt = db.prepare(`
  INSERT INTO email_attachments (
    email_id, filename, mime_type, size, storage_path,
    extraction_status, extraction_error, extracted_text
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const getByIdStmt = db.prepare(`
  SELECT * FROM email_attachments WHERE id = ?
`);

const getByEmailIdStmt = db.prepare(`
  SELECT * FROM email_attachments WHERE email_id = ?
`);

const getFailedStmt = db.prepare(`
  SELECT ea.*, e.user_id, e.subject, e.from_email
  FROM email_attachments ea
  JOIN emails e ON ea.email_id = e.id
  WHERE ea.extraction_status = 'failed'
  ORDER BY ea.created_at DESC
`);

const getFailedByUserStmt = db.prepare(`
  SELECT ea.*, e.user_id, e.subject, e.from_email
  FROM email_attachments ea
  JOIN emails e ON ea.email_id = e.id
  WHERE ea.extraction_status = 'failed' AND e.user_id = ?
  ORDER BY ea.created_at DESC
`);

const updateStatusStmt = db.prepare(`
  UPDATE email_attachments
  SET extraction_status = ?, extraction_error = ?, extracted_text = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const deleteByEmailIdStmt = db.prepare(`
  DELETE FROM email_attachments WHERE email_id = ?
`);

const countByEmailStmt = db.prepare(`
  SELECT COUNT(*) as total FROM email_attachments WHERE email_id = ?
`);

const countFailedByEmailStmt = db.prepare(`
  SELECT COUNT(*) as total FROM email_attachments WHERE email_id = ? AND extraction_status = 'failed'
`);

/**
 * Helper to parse attachment row from database
 */
function parseAttachmentRow(row: any): StoredAttachment {
  return {
    id: row.id,
    email_id: row.email_id,
    filename: row.filename,
    mime_type: row.mime_type || undefined,
    size: row.size || undefined,
    storage_path: row.storage_path,
    extraction_status: row.extraction_status,
    extraction_error: row.extraction_error || undefined,
    extracted_text: row.extracted_text || undefined,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

/**
 * Create a new attachment record
 *
 * @param data - Attachment data
 * @returns Created attachment ID
 */
export function createAttachmentRecord(data: CreateAttachmentInput): number {
  const result = insertStmt.run(
    data.email_id,
    data.filename,
    data.mime_type || null,
    data.size || null,
    data.storage_path,
    data.extraction_status || 'pending',
    data.extraction_error || null,
    data.extracted_text || null
  );

  return result.lastInsertRowid as number;
}

/**
 * Get attachment by ID
 *
 * @param attachmentId - Attachment ID
 * @returns Attachment or null
 */
export function getAttachmentById(attachmentId: number): StoredAttachment | null {
  const row = getByIdStmt.get(attachmentId) as any;
  return row ? parseAttachmentRow(row) : null;
}

/**
 * Get all attachments for an email
 *
 * @param emailId - Email ID
 * @returns Array of attachments
 */
export function getAttachmentsByEmailId(emailId: number): StoredAttachment[] {
  const rows = getByEmailIdStmt.all(emailId) as any[];
  return rows.map(parseAttachmentRow);
}

/**
 * Get all failed attachments (optionally filtered by user)
 *
 * @param userId - Optional user ID filter
 * @returns Array of failed attachments with email info
 */
export function getFailedAttachments(userId?: string): (StoredAttachment & {
  user_id: string;
  subject: string;
  from_email: string;
})[] {
  const rows = userId
    ? getFailedByUserStmt.all(userId) as any[]
    : getFailedStmt.all() as any[];

  return rows.map(row => ({
    ...parseAttachmentRow(row),
    user_id: row.user_id,
    subject: row.subject,
    from_email: row.from_email,
  }));
}

/**
 * Update extraction status for an attachment
 *
 * @param attachmentId - Attachment ID
 * @param status - New status
 * @param error - Optional error message (for failed status)
 * @param extractedText - Optional extracted text (for success status)
 */
export function updateExtractionStatus(
  attachmentId: number,
  status: 'pending' | 'success' | 'failed' | 'skipped',
  error?: string,
  extractedText?: string
): void {
  updateStatusStmt.run(status, error || null, extractedText || null, attachmentId);
}

/**
 * Delete all attachment records for an email
 *
 * @param emailId - Email ID
 * @returns Number of deleted records
 */
export function deleteAttachmentRecords(emailId: number): number {
  const result = deleteByEmailIdStmt.run(emailId);
  return result.changes;
}

/**
 * Get attachment counts for an email
 *
 * @param emailId - Email ID
 * @returns Total and failed counts
 */
export function getAttachmentCounts(emailId: number): { total: number; failed: number } {
  const totalRow = countByEmailStmt.get(emailId) as any;
  const failedRow = countFailedByEmailStmt.get(emailId) as any;

  return {
    total: totalRow?.total || 0,
    failed: failedRow?.total || 0,
  };
}
