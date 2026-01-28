// src/utils/attachmentStorage.ts
import { join } from 'path';
import { mkdirSync, existsSync, writeFileSync, readFileSync, rmSync } from 'fs';

// Base directory for attachment storage
const ATTACHMENTS_BASE_DIR = process.env.ATTACHMENTS_PATH || join(process.cwd(), 'data', 'attachments');

/**
 * Get the storage directory for a specific user/email combination
 */
export function getStorageDir(userId: string, emailId: number): string {
  return join(ATTACHMENTS_BASE_DIR, userId, String(emailId));
}

/**
 * Get the relative storage path (for DB storage)
 */
export function getRelativeStoragePath(userId: string, emailId: number, filename: string): string {
  // Sanitize filename to prevent path traversal
  const sanitizedFilename = filename.replace(/[/\\:*?"<>|]/g, '_');
  return join(userId, String(emailId), sanitizedFilename);
}

/**
 * Get the full path from a relative storage path
 */
export function getFullPath(relativePath: string): string {
  return join(ATTACHMENTS_BASE_DIR, relativePath);
}

/**
 * Save an attachment to the filesystem
 *
 * @param userId - User ID
 * @param emailId - Email ID (from emails table)
 * @param filename - Original filename
 * @param buffer - File content as Buffer
 * @returns Relative storage path for DB storage
 */
export function saveAttachment(
  userId: string,
  emailId: number,
  filename: string,
  buffer: Buffer
): string {
  const dir = getStorageDir(userId, emailId);

  // Ensure directory exists
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Sanitize filename
  const sanitizedFilename = filename.replace(/[/\\:*?"<>|]/g, '_');
  const fullPath = join(dir, sanitizedFilename);

  // Write file
  writeFileSync(fullPath, buffer);

  // Return relative path for DB storage
  return getRelativeStoragePath(userId, emailId, filename);
}

/**
 * Get an attachment from the filesystem
 *
 * @param storagePath - Relative storage path from DB
 * @returns File content as Buffer, or null if not found
 */
export function getAttachment(storagePath: string): Buffer | null {
  const fullPath = getFullPath(storagePath);

  if (!existsSync(fullPath)) {
    console.error(`Attachment not found: ${fullPath}`);
    return null;
  }

  return readFileSync(fullPath);
}

/**
 * Delete all attachments for an email
 *
 * @param userId - User ID
 * @param emailId - Email ID
 * @returns true if deleted, false if directory didn't exist
 */
export function deleteAttachments(userId: string, emailId: number): boolean {
  const dir = getStorageDir(userId, emailId);

  if (!existsSync(dir)) {
    return false;
  }

  rmSync(dir, { recursive: true, force: true });
  return true;
}

/**
 * Check if attachments exist for an email
 */
export function attachmentsExist(userId: string, emailId: number): boolean {
  const dir = getStorageDir(userId, emailId);
  return existsSync(dir);
}

/**
 * Ensure the base attachments directory exists
 */
export function ensureAttachmentsDir(): void {
  if (!existsSync(ATTACHMENTS_BASE_DIR)) {
    mkdirSync(ATTACHMENTS_BASE_DIR, { recursive: true });
    console.log(`Created attachments directory: ${ATTACHMENTS_BASE_DIR}`);
  }
}
