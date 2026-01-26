// src/utils/attachmentExtractor.ts
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import mammoth from 'mammoth';

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
 */
async function downloadAndExtractAttachment(
  gmail: any,
  messageId: string,
  attachment: Attachment
): Promise<string> {
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
      return `[${attachment.filename} - no data in response]`;
    }

    const buffer = Buffer.from(data, 'base64');

    // Extract text based on mime type
    const text = await extractTextFromAttachment(buffer, attachment.mimeType, attachment.filename);

    console.log(`✓ Extracted ${attachment.filename}: ${text.length} characters`);
    return text;
  } catch (error: any) {
    console.error(`Failed to download attachment ${attachment.filename}:`, error.message);
    return `[${attachment.filename} - download failed: ${error.message}]`;
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
 * Get attachment text for an email
 * Downloads and extracts text from all extractable attachments
 *
 * @param auth - OAuth2Client with Gmail access
 * @param messageId - Gmail message ID
 * @param payload - Gmail message payload
 * @returns Concatenated text from all attachments
 */
export async function getAttachmentText(
  auth: OAuth2Client,
  messageId: string,
  payload: any
): Promise<string> {
  const gmail = google.gmail({ version: 'v1', auth });

  // Extract attachment metadata
  const attachments = extractAttachmentsFromPayload(payload);

  if (attachments.length === 0) {
    return '';
  }

  // Filter attachments we can extract text from
  const extractableAttachments = attachments.filter(shouldExtractAttachment);

  if (extractableAttachments.length === 0) {
    // List non-extractable attachment names
    const fileList = attachments.map((a) => a.filename).join(', ');
    return `\n\n--- Attachments (no text extraction) ---\n${fileList}`;
  }

  // Download and extract text from each attachment
  const extractionPromises = extractableAttachments.map((attachment) =>
    downloadAndExtractAttachment(gmail, messageId, attachment)
  );

  const extractedTexts = await Promise.all(extractionPromises);

  // Format extracted text with clear markers for AI processing
  let result = '\n\n=== IMPORTANT: ATTACHMENT CONTENT BELOW ===\n';
  result += 'This email contains document attachments. Extract all relevant information:\n';
  result += '- Key dates and deadlines → add to calendar_updates\n';
  result += '- Payment requests → add to financials with amounts and deadlines\n';
  result += '- Action items → mention in summary\n';
  result += '- If forms require signature/action → add to attachments_requiring_review\n\n';

  extractableAttachments.forEach((attachment, index) => {
    const text = extractedTexts[index] || '';
    if (text && text.length > 0) {
      result += `--- START: ${attachment.filename} ---\n`;
      result += text + '\n';
      result += `--- END: ${attachment.filename} ---\n\n`;
    }
  });

  // List any non-extractable attachments
  const nonExtractable = attachments.filter((a) => !shouldExtractAttachment(a));
  if (nonExtractable.length > 0) {
    const fileList = nonExtractable.map((a) => a.filename).join(', ');
    result += `\nNOTE: Additional attachments that could not be read: ${fileList}\n`;
    result += 'These may contain images, forms, or other content requiring manual review.\n';
  }

  result += '\n=== END ATTACHMENT CONTENT ===\n';

  return result;
}
