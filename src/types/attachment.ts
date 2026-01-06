// src/types/attachment.ts

/**
 * Parameters for saving an attachment from Gmail to Drive
 */
export interface AttachmentSaveParams {
  emailId: string; // Gmail message ID
  attachmentId: string; // Attachment ID from email metadata
  fileName: string; // File name (extracted from email or default)
}

/**
 * Result of saving an attachment
 */
export interface AttachmentSaveResult {
  success: boolean;
  fileId?: string; // Drive file ID if successful
  error?: string;
}
