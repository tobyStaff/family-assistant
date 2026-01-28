// src/utils/attachmentExtractor.ts
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import mammoth from 'mammoth';
import { saveAttachment, getAttachment } from './attachmentStorage.js';
import {
  createAttachmentRecord,
  updateExtractionStatus,
  getAttachmentsByEmailId,
  type StoredAttachment,
} from '../db/attachmentDb.js';

/**
 * Attachment metadata
 */
export interface Attachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

/**
 * Downloaded attachment with buffer
 */
export interface DownloadedAttachment extends Attachment {
  buffer: Buffer;
  extractedText: string;
  extractionFailed: boolean;
  extractionError?: string;
}

/**
 * Extract text from PDF buffer using PDF.js
 */
async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  try {
    // Import PDF.js library (use legacy build for Node.js compatibility)
    // @ts-ignore - dynamic import path
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
    const pdfjsLib = pdfjs.default || pdfjs;

    // Load PDF document (PDF.js requires Uint8Array, not Buffer)
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const pdf = await loadingTask.promise;

    // Extract text from all pages
    const textParts: string[] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');

      textParts.push(pageText);
    }

    const fullText = textParts.join('\n\n').trim();
    console.log(`✓ Extracted PDF: ${pdf.numPages} pages, ${fullText.length} characters`);

    return fullText || '[PDF - no text content]';
  } catch (error: any) {
    console.error('Failed to extract text from PDF:', {
      message: error.message,
      name: error.name
    });
    return `[PDF content - extraction failed: ${error.message}]`;
  }
}

/**
 * Extract text from DOCX buffer
 */
async function extractTextFromDOCX(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  } catch (error: any) {
    console.error('Failed to extract text from DOCX:', error.message);
    return '[DOCX content - extraction failed]';
  }
}

/**
 * Extract text from plain text buffer
 */
function extractTextFromPlainText(buffer: Buffer): string {
  try {
    return buffer.toString('utf-8').trim();
  } catch (error: any) {
    console.error('Failed to extract text from plain text:', error.message);
    return '[Text file content - extraction failed]';
  }
}

/**
 * Determine if attachment should be extracted based on mime type and size
 */
export function shouldExtractAttachment(attachment: Attachment): boolean {
  // Skip very large files (> 5MB)
  if (attachment.size > 5 * 1024 * 1024) {
    return false;
  }

  // Extract text from these types
  const extractableTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
    'application/msword', // DOC
    'text/plain',
    'text/html',
    'text/csv',
  ];

  return extractableTypes.some((type) => attachment.mimeType.startsWith(type));
}

/**
 * Extract text content from attachment based on mime type
 */
async function extractTextFromAttachment(
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<string> {
  try {
    // PDF
    if (mimeType === 'application/pdf') {
      return await extractTextFromPDF(buffer);
    }

    // DOCX
    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/msword'
    ) {
      return await extractTextFromDOCX(buffer);
    }

    // Plain text
    if (mimeType.startsWith('text/')) {
      // For HTML, do basic tag removal
      const text = extractTextFromPlainText(buffer);
      if (mimeType === 'text/html') {
        return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      }
      return text;
    }

    return `[${filename} - unsupported format]`;
  } catch (error: any) {
    console.error(`Failed to extract text from ${filename}:`, error.message);
    return `[${filename} - extraction failed]`;
  }
}

/**
 * Download and extract text from Gmail attachment
 * Returns both the extracted text and the raw buffer for storage
 */
async function downloadAndExtractAttachment(
  gmail: any,
  messageId: string,
  attachment: Attachment
): Promise<DownloadedAttachment> {
  try {
    // Download attachment
    const response = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: messageId,
      id: attachment.attachmentId,
    });

    // Decode base64 data
    const data = response.data.data;
    if (!data) {
      console.error(`No data in response for ${attachment.filename}`);
      return {
        ...attachment,
        buffer: Buffer.alloc(0),
        extractedText: `[${attachment.filename} - no data in response]`,
        extractionFailed: true,
        extractionError: 'No data in response',
      };
    }

    const buffer = Buffer.from(data, 'base64');

    // Extract text based on mime type
    const text = await extractTextFromAttachment(buffer, attachment.mimeType, attachment.filename);
    const extractionFailed = text.includes('extraction failed') || text.includes('download failed');

    console.log(`✓ Extracted ${attachment.filename}: ${text.length} characters`);
    return {
      ...attachment,
      buffer,
      extractedText: text,
      extractionFailed,
      extractionError: extractionFailed ? text : undefined,
    };
  } catch (error: any) {
    console.error(`Failed to download attachment ${attachment.filename}:`, error.message);
    return {
      ...attachment,
      buffer: Buffer.alloc(0),
      extractedText: `[${attachment.filename} - download failed: ${error.message}]`,
      extractionFailed: true,
      extractionError: error.message,
    };
  }
}

/**
 * Extract attachments from Gmail message payload
 */
function extractAttachmentsFromPayload(payload: any): Attachment[] {
  const attachments: Attachment[] = [];

  function traverse(part: any) {
    // Check if this part is an attachment
    if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType || 'application/octet-stream',
        size: part.body.size || 0,
        attachmentId: part.body.attachmentId,
      });
    }

    // Recursively check nested parts
    if (part.parts) {
      part.parts.forEach(traverse);
    }
  }

  traverse(payload);
  return attachments;
}

/**
 * Result of attachment extraction including downloadable data
 */
export interface AttachmentExtractionResult {
  text: string;
  downloadedAttachments: DownloadedAttachment[];
  nonExtractableFilenames: string[];
}

/**
 * Get attachment text for an email
 * Downloads and extracts text from all extractable attachments
 *
 * @param auth - OAuth2Client with Gmail access
 * @param messageId - Gmail message ID
 * @param payload - Gmail message payload
 * @returns Extraction result with text and raw attachment data
 */
export async function getAttachmentText(
  auth: OAuth2Client,
  messageId: string,
  payload: any
): Promise<AttachmentExtractionResult> {
  const gmail = google.gmail({ version: 'v1', auth });

  // Extract attachment metadata
  const attachments = extractAttachmentsFromPayload(payload);

  if (attachments.length === 0) {
    return { text: '', downloadedAttachments: [], nonExtractableFilenames: [] };
  }

  // Filter attachments we can extract text from
  const extractableAttachments = attachments.filter(shouldExtractAttachment);
  const nonExtractable = attachments.filter((a) => !shouldExtractAttachment(a));
  const nonExtractableFilenames = nonExtractable.map((a) => a.filename);

  if (extractableAttachments.length === 0) {
    // List non-extractable attachment names
    const fileList = nonExtractableFilenames.join(', ');
    return {
      text: `\n\n--- Attachments (no text extraction) ---\n${fileList}`,
      downloadedAttachments: [],
      nonExtractableFilenames,
    };
  }

  // Download and extract text from each attachment
  const extractionPromises = extractableAttachments.map((attachment) =>
    downloadAndExtractAttachment(gmail, messageId, attachment)
  );

  const downloadedAttachments = await Promise.all(extractionPromises);

  // Format extracted text with clear markers for AI processing
  let result = '\n\n=== IMPORTANT: ATTACHMENT CONTENT BELOW ===\n';
  result += 'This email contains document attachments. Extract all relevant information:\n';
  result += '- Key dates and deadlines → add to calendar_updates\n';
  result += '- Payment requests → add to financials with amounts and deadlines\n';
  result += '- Action items → mention in summary\n';
  result += '- If forms require signature/action → add to attachments_requiring_review\n\n';

  downloadedAttachments.forEach((downloaded) => {
    const text = downloaded.extractedText || '';
    if (text && text.length > 0) {
      result += `--- START: ${downloaded.filename} ---\n`;
      result += text + '\n';
      result += `--- END: ${downloaded.filename} ---\n\n`;
    }
  });

  // List any non-extractable attachments
  if (nonExtractableFilenames.length > 0) {
    const fileList = nonExtractableFilenames.join(', ');
    result += `\nNOTE: Additional attachments that could not be read: ${fileList}\n`;
    result += 'These may contain images, forms, or other content requiring manual review.\n';
  }

  result += '\n=== END ATTACHMENT CONTENT ===\n';

  return { text: result, downloadedAttachments, nonExtractableFilenames };
}

/**
 * Store downloaded attachments to filesystem and create DB records
 *
 * @param userId - User ID
 * @param emailId - Email ID (from emails table)
 * @param downloadedAttachments - Attachments to store
 * @returns Number of attachments stored
 */
export function storeDownloadedAttachments(
  userId: string,
  emailId: number,
  downloadedAttachments: DownloadedAttachment[]
): number {
  let stored = 0;

  for (const attachment of downloadedAttachments) {
    try {
      // Skip attachments with no data
      if (attachment.buffer.length === 0) {
        // Still create a record to track the failure
        createAttachmentRecord({
          email_id: emailId,
          filename: attachment.filename,
          mime_type: attachment.mimeType,
          size: attachment.size,
          storage_path: '', // No file stored
          extraction_status: 'failed',
          extraction_error: attachment.extractionError || 'No data downloaded',
          extracted_text: attachment.extractedText,
        });
        continue;
      }

      // Save to filesystem
      const storagePath = saveAttachment(userId, emailId, attachment.filename, attachment.buffer);

      // Create DB record
      createAttachmentRecord({
        email_id: emailId,
        filename: attachment.filename,
        mime_type: attachment.mimeType,
        size: attachment.buffer.length,
        storage_path: storagePath,
        extraction_status: attachment.extractionFailed ? 'failed' : 'success',
        extraction_error: attachment.extractionError,
        extracted_text: attachment.extractedText,
      });

      stored++;
      console.log(`✓ Stored attachment: ${attachment.filename} (${storagePath})`);
    } catch (error: any) {
      console.error(`Failed to store attachment ${attachment.filename}:`, error.message);
      // Create a failed record
      try {
        createAttachmentRecord({
          email_id: emailId,
          filename: attachment.filename,
          mime_type: attachment.mimeType,
          size: attachment.size,
          storage_path: '',
          extraction_status: 'failed',
          extraction_error: `Storage failed: ${error.message}`,
        });
      } catch {
        // Ignore DB errors
      }
    }
  }

  return stored;
}

/**
 * Retry extraction for a single attachment
 *
 * @param attachmentId - Attachment ID from email_attachments table
 * @returns Result with success status and extracted text
 */
export async function retryExtraction(
  attachmentId: number
): Promise<{ success: boolean; extractedText?: string; error?: string }> {
  // Get attachment record
  const attachments = getAttachmentsByEmailId(0); // Need to get by ID instead
  // Actually we need to get by attachment ID - let me check the DB module

  // For now, use a direct query approach
  const { getAttachmentById } = await import('../db/attachmentDb.js');
  const attachment = getAttachmentById(attachmentId);

  if (!attachment) {
    return { success: false, error: 'Attachment not found' };
  }

  if (!attachment.storage_path) {
    return { success: false, error: 'No stored file available for retry' };
  }

  // Load file from filesystem
  const buffer = getAttachment(attachment.storage_path);
  if (!buffer) {
    return { success: false, error: 'File not found on filesystem' };
  }

  try {
    // Re-extract text
    const extractedText = await extractTextFromAttachment(
      buffer,
      attachment.mime_type || 'application/octet-stream',
      attachment.filename
    );

    const failed = extractedText.includes('extraction failed');

    // Update DB record
    updateExtractionStatus(
      attachmentId,
      failed ? 'failed' : 'success',
      failed ? extractedText : undefined,
      extractedText
    );

    return {
      success: !failed,
      extractedText,
      error: failed ? extractedText : undefined,
    };
  } catch (error: any) {
    updateExtractionStatus(attachmentId, 'failed', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Rebuild attachment_content for an email from stored attachment records
 *
 * @param emailId - Email ID
 * @returns Rebuilt attachment content string
 */
export function rebuildAttachmentContent(emailId: number): string {
  const attachments = getAttachmentsByEmailId(emailId);

  if (attachments.length === 0) {
    return '';
  }

  const successfulAttachments = attachments.filter(a => a.extraction_status === 'success' && a.extracted_text);
  const failedAttachments = attachments.filter(a => a.extraction_status === 'failed');
  const skippedAttachments = attachments.filter(a => a.extraction_status === 'skipped');

  if (successfulAttachments.length === 0 && failedAttachments.length === 0) {
    const fileList = skippedAttachments.map(a => a.filename).join(', ');
    return `\n\n--- Attachments (no text extraction) ---\n${fileList}`;
  }

  let result = '\n\n=== IMPORTANT: ATTACHMENT CONTENT BELOW ===\n';
  result += 'This email contains document attachments. Extract all relevant information:\n';
  result += '- Key dates and deadlines → add to calendar_updates\n';
  result += '- Payment requests → add to financials with amounts and deadlines\n';
  result += '- Action items → mention in summary\n';
  result += '- If forms require signature/action → add to attachments_requiring_review\n\n';

  for (const attachment of successfulAttachments) {
    result += `--- START: ${attachment.filename} ---\n`;
    result += (attachment.extracted_text || '') + '\n';
    result += `--- END: ${attachment.filename} ---\n\n`;
  }

  // List failed attachments
  if (failedAttachments.length > 0) {
    for (const attachment of failedAttachments) {
      result += `--- START: ${attachment.filename} ---\n`;
      result += (attachment.extracted_text || `[${attachment.filename} - extraction failed]`) + '\n';
      result += `--- END: ${attachment.filename} ---\n\n`;
    }
  }

  // List skipped attachments
  if (skippedAttachments.length > 0) {
    const fileList = skippedAttachments.map(a => a.filename).join(', ');
    result += `\nNOTE: Additional attachments that could not be read: ${fileList}\n`;
    result += 'These may contain images, forms, or other content requiring manual review.\n';
  }

  result += '\n=== END ATTACHMENT CONTENT ===\n';

  return result;
}
