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
import {
  extractTextWithVision,
  isImageMimeType,
  IMAGE_MIME_TYPES,
} from './visionExtractor.js';

/**
 * Size and page limits for extraction
 */
const MAX_PDF_SIZE_MB = 5;
const MAX_IMAGE_SIZE_MB = 2;
const MAX_VISION_PDF_PAGES = 6;
const MAX_IMAGES_PER_EMAIL = 5;

/**
 * Format file size in MB for display
 */
function formatSizeMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

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
 * Result from PDF text extraction
 */
interface PDFExtractionResult {
  text: string;
  pageCount: number;
  isEmpty: boolean;
  error?: string;
}

/**
 * Extract text from PDF buffer using PDF.js
 * Returns structured result with page count for vision fallback decisions
 */
async function extractTextFromPDFWithMetadata(buffer: Buffer): Promise<PDFExtractionResult> {
  try {
    // Import PDF.js library
    const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
    const pdfjsLib = pdfjs;

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

    // Consider PDF "empty" if it has very little text (likely scanned/image-based)
    const isEmpty = fullText.length < 50;

    return {
      text: fullText,
      pageCount: pdf.numPages,
      isEmpty,
    };
  } catch (error: any) {
    console.error('Failed to extract text from PDF:', {
      message: error.message,
      name: error.name
    });
    return {
      text: '',
      pageCount: 0,
      isEmpty: true,
      error: error.message,
    };
  }
}

/**
 * Extract text from PDF buffer, with AI Vision fallback for scanned documents
 */
async function extractTextFromPDF(buffer: Buffer, filename: string): Promise<string> {
  // First try standard text extraction
  const result = await extractTextFromPDFWithMetadata(buffer);

  // If extraction failed completely, report the error
  if (result.error) {
    return `[PDF content - extraction failed: ${result.error}]`;
  }

  // If we got text, return it
  if (!result.isEmpty) {
    return result.text;
  }

  // PDF appears to be scanned/image-based - try vision fallback
  console.log(`📄 PDF appears scanned, attempting AI Vision fallback: ${filename}`);

  // Check page count limit for vision
  if (result.pageCount > MAX_VISION_PDF_PAGES) {
    return `[Scanned PDF too long: ${result.pageCount} pages exceeds ${MAX_VISION_PDF_PAGES}-page OCR limit]`;
  }

  // Try vision extraction
  const visionResult = await extractTextWithVision(buffer, 'application/pdf', filename);

  if (visionResult.success && visionResult.text) {
    // Check for "no content" responses from vision
    if (visionResult.text === '[No text content]' || visionResult.text === '[Non-document image]') {
      return `[PDF - no readable text detected]`;
    }
    return visionResult.text;
  }

  // Vision also failed
  if (visionResult.error) {
    return `[OCR failed: ${visionResult.error}]`;
  }

  return '[PDF - no text content]';
}

/**
 * Extract text from image using AI Vision
 */
async function extractTextFromImage(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
  console.log(`🖼️ Extracting text from image: ${filename}`);

  const result = await extractTextWithVision(buffer, mimeType, filename);

  if (result.success && result.text) {
    // Check for "no content" responses
    if (result.text === '[No text content]') {
      return `[Image - no readable text detected]`;
    }
    if (result.text === '[Non-document image]') {
      return `[Image - photo/graphic, not a document]`;
    }
    return result.text;
  }

  if (result.error) {
    return `[Image OCR failed: ${result.error}]`;
  }

  return `[Image - no text extracted]`;
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
 * Check why an attachment cannot be extracted (for descriptive skip messages)
 */
export function getSkipReason(attachment: Attachment): string | null {
  const mimeType = attachment.mimeType.toLowerCase();
  const sizeMB = attachment.size / (1024 * 1024);

  // Check PDF size limit
  if (mimeType === 'application/pdf') {
    if (sizeMB > MAX_PDF_SIZE_MB) {
      return `[PDF too large: ${formatSizeMB(attachment.size)}MB exceeds ${MAX_PDF_SIZE_MB}MB limit]`;
    }
    return null; // PDF is extractable
  }

  // Check image size limit
  if (isImageMimeType(mimeType)) {
    if (sizeMB > MAX_IMAGE_SIZE_MB) {
      return `[Image too large: ${formatSizeMB(attachment.size)}MB exceeds ${MAX_IMAGE_SIZE_MB}MB limit]`;
    }
    return null; // Image is extractable
  }

  // Check DOCX/DOC
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword'
  ) {
    if (sizeMB > MAX_PDF_SIZE_MB) {
      return `[Document too large: ${formatSizeMB(attachment.size)}MB exceeds ${MAX_PDF_SIZE_MB}MB limit]`;
    }
    return null; // DOCX is extractable
  }

  // Check text files
  if (mimeType.startsWith('text/')) {
    if (sizeMB > MAX_PDF_SIZE_MB) {
      return `[Text file too large: ${formatSizeMB(attachment.size)}MB exceeds ${MAX_PDF_SIZE_MB}MB limit]`;
    }
    return null; // Text is extractable
  }

  // Unsupported format
  return `[Unsupported format: ${attachment.mimeType}]`;
}

/**
 * Determine if attachment should be extracted based on mime type and size
 */
export function shouldExtractAttachment(attachment: Attachment): boolean {
  return getSkipReason(attachment) === null;
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
    // PDF (with vision fallback for scanned documents)
    if (mimeType === 'application/pdf') {
      return await extractTextFromPDF(buffer, filename);
    }

    // Images (via AI Vision)
    if (isImageMimeType(mimeType)) {
      return await extractTextFromImage(buffer, mimeType, filename);
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

    return `[${filename} - unsupported format: ${mimeType}]`;
  } catch (error: any) {
    console.error(`Failed to extract text from ${filename}:`, error.message);
    return `[${filename} - extraction failed: ${error.message}]`;
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

  // Categorize attachments with skip reasons
  const extractableAttachments: Attachment[] = [];
  const skippedWithReasons: { filename: string; reason: string }[] = [];
  let imageCount = 0;

  for (const attachment of attachments) {
    const skipReason = getSkipReason(attachment);

    if (skipReason) {
      // Attachment cannot be extracted
      skippedWithReasons.push({ filename: attachment.filename, reason: skipReason });
    } else if (isImageMimeType(attachment.mimeType)) {
      // Check image count limit
      if (imageCount >= MAX_IMAGES_PER_EMAIL) {
        skippedWithReasons.push({
          filename: attachment.filename,
          reason: `[Image skipped: exceeds ${MAX_IMAGES_PER_EMAIL} images per email limit]`,
        });
      } else {
        extractableAttachments.push(attachment);
        imageCount++;
      }
    } else {
      extractableAttachments.push(attachment);
    }
  }

  const nonExtractableFilenames = skippedWithReasons.map((s) => s.filename);

  if (extractableAttachments.length === 0) {
    // Build detailed skip list
    const skipList = skippedWithReasons
      .map((s) => `${s.filename}: ${s.reason}`)
      .join('\n');
    return {
      text: `\n\n--- Attachments (skipped) ---\n${skipList}`,
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

  // List any skipped attachments with reasons
  if (skippedWithReasons.length > 0) {
    result += '\nNOTE: Some attachments were skipped:\n';
    for (const skip of skippedWithReasons) {
      result += `- ${skip.filename}: ${skip.reason}\n`;
    }
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
 * Now includes AI Vision fallback for scanned PDFs and images
 *
 * @param attachmentId - Attachment ID from email_attachments table
 * @returns Result with success status and extracted text
 */
export async function retryExtraction(
  attachmentId: number
): Promise<{ success: boolean; extractedText?: string; error?: string }> {
  // Get attachment record
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
    // Re-extract text (now with vision fallback support)
    const extractedText = await extractTextFromAttachment(
      buffer,
      attachment.mime_type || 'application/octet-stream',
      attachment.filename
    );

    // Check for various failure indicators
    const failed =
      extractedText.includes('extraction failed') ||
      extractedText.includes('OCR failed') ||
      extractedText.includes('too large') ||
      extractedText.includes('too long');

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
