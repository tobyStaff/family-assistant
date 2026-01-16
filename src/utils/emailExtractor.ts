// src/utils/emailExtractor.ts
import { gmail_v1 } from 'googleapis';

/**
 * Extract plain text content from Gmail message
 * Handles base64 decoding and multipart MIME structure
 *
 * @param message - Gmail message data
 * @returns Decoded email content as plain text
 */
export function getEmailContent(message: gmail_v1.Schema$Message): string {
  const payload = message.payload;
  if (!payload) return '';

  // Try to get plain text from body
  if (payload.body?.data) {
    return decodeBase64(payload.body.data);
  }

  // Handle multipart MIME (check parts)
  if (payload.parts && payload.parts.length > 0) {
    // Find text/plain part first, fall back to text/html
    const textPart = payload.parts.find(part => part.mimeType === 'text/plain');
    if (textPart?.body?.data) {
      return decodeBase64(textPart.body.data);
    }

    // Fall back to text/html (strip HTML tags)
    const htmlPart = payload.parts.find(part => part.mimeType === 'text/html');
    if (htmlPart?.body?.data) {
      const html = decodeBase64(htmlPart.body.data);
      return stripHtml(html);
    }

    // Recursively search nested parts (for complex multipart structures)
    for (const part of payload.parts) {
      if (part.parts && part.parts.length > 0) {
        const nestedText = findTextInParts(part.parts);
        if (nestedText) return nestedText;
      }
    }
  }

  return '';
}

/**
 * Recursively find text content in nested MIME parts
 */
function findTextInParts(parts: gmail_v1.Schema$MessagePart[]): string {
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return decodeBase64(part.body.data);
    }
    if (part.parts) {
      const nestedText = findTextInParts(part.parts);
      if (nestedText) return nestedText;
    }
  }
  return '';
}

/**
 * Decode base64-encoded Gmail content
 * Gmail uses URL-safe base64 (RFC 4648)
 */
function decodeBase64(data: string): string {
  // Convert URL-safe base64 to standard base64
  const standardBase64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(standardBase64, 'base64').toString('utf-8');
}

/**
 * Strip HTML tags from content (basic implementation)
 * For more robust HTML parsing, consider using a library like cheerio
 */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>.*?<\/style>/gi, '') // Remove style blocks
    .replace(/<script[^>]*>.*?<\/script>/gi, '') // Remove script blocks
    .replace(/<[^>]+>/g, '') // Remove HTML tags
    .replace(/&nbsp;/g, ' ') // Replace &nbsp;
    .replace(/&lt;/g, '<') // Replace &lt;
    .replace(/&gt;/g, '>') // Replace &gt;
    .replace(/&amp;/g, '&') // Replace &amp;
    .trim();
}

/**
 * Extract attachment information from Gmail message
 *
 * @param message - Gmail message data
 * @returns Array of attachment metadata
 */
export function getAttachments(
  message: gmail_v1.Schema$Message
): Array<{ id: string; filename: string; mimeType: string; size: number }> {
  const attachments: Array<{ id: string; filename: string; mimeType: string; size: number }> = [];
  const payload = message.payload;

  if (!payload || !payload.parts) {
    return attachments;
  }

  // Recursively search for attachments in parts
  const findAttachments = (parts: gmail_v1.Schema$MessagePart[]) => {
    for (const part of parts) {
      // Check if part is an attachment
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          id: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || 0,
        });
      }

      // Recursively search nested parts
      if (part.parts) {
        findAttachments(part.parts);
      }
    }
  };

  findAttachments(payload.parts);
  return attachments;
}

/**
 * Get email subject from message headers
 */
export function getEmailSubject(message: gmail_v1.Schema$Message): string {
  const headers = message.payload?.headers || [];
  const subjectHeader = headers.find(h => h.name?.toLowerCase() === 'subject');
  return subjectHeader?.value || '(no subject)';
}

/**
 * Get sender email from message headers
 */
export function getEmailSender(message: gmail_v1.Schema$Message): string {
  const headers = message.payload?.headers || [];
  const fromHeader = headers.find(h => h.name?.toLowerCase() === 'from');
  return fromHeader?.value || '';
}
