// src/utils/inboxFetcher.ts
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { EmailMetadata } from '../types/summary.js';
import { getAttachmentText } from './attachmentExtractor.js';

/**
 * Date range options for fetching emails
 */
export type DateRange = 'today' | 'yesterday' | 'last3days' | 'last7days' | 'last30days' | 'last90days';

/**
 * Get date string for Gmail query based on range
 */
function getDateForRange(range: DateRange): string {
  const now = new Date();
  let targetDate: Date;

  switch (range) {
    case 'today':
      targetDate = new Date(now.setHours(0, 0, 0, 0));
      break;
    case 'yesterday':
      targetDate = new Date(now.setDate(now.getDate() - 1));
      targetDate.setHours(0, 0, 0, 0);
      break;
    case 'last3days':
      targetDate = new Date(now.setDate(now.getDate() - 3));
      break;
    case 'last7days':
      targetDate = new Date(now.setDate(now.getDate() - 7));
      break;
    case 'last30days':
      targetDate = new Date(now.setDate(now.getDate() - 30));
      break;
    case 'last90days':
      targetDate = new Date(now.setDate(now.getDate() - 90));
      break;
  }

  // Format as YYYY/MM/DD for Gmail query
  const year = targetDate.getFullYear();
  const month = String(targetDate.getMonth() + 1).padStart(2, '0');
  const day = String(targetDate.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

/**
 * Extract sender name and email from Gmail 'From' header
 *
 * @param fromHeader - Gmail From header (e.g., "John Doe <john@example.com>")
 * @returns Parsed sender info
 */
function parseSender(fromHeader: string): { name: string; email: string } {
  // Pattern: "Name <email@domain.com>" or just "email@domain.com"
  const match = fromHeader.match(/^(.+?)\s*<(.+?)>$/);

  if (match) {
    return {
      name: match[1]?.trim().replace(/^["']|["']$/g, '') || fromHeader.trim(), // Remove quotes
      email: match[2]?.trim() || fromHeader.trim(),
    };
  }

  // Just email address
  return {
    name: fromHeader.trim(),
    email: fromHeader.trim(),
  };
}

/**
 * Fetch recent emails from Gmail inbox
 *
 * @param auth - OAuth2Client with Gmail access
 * @param dateRange - Date range to fetch ('yesterday' by default)
 * @param maxResults - Maximum number of emails to fetch (default: 100)
 * @returns Array of email metadata
 */
export async function fetchRecentEmails(
  auth: OAuth2Client,
  dateRange: DateRange = 'yesterday',
  maxResults: number = 100
): Promise<EmailMetadata[]> {
  const gmail = google.gmail({ version: 'v1', auth });

  // Build Gmail query
  const afterDate = getDateForRange(dateRange);
  const query = `after:${afterDate} -in:spam -in:trash -in:sent`;

  try {
    // List message IDs
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
    });

    const messages = listResponse.data.messages || [];

    if (messages.length === 0) {
      return [];
    }

    // Fetch message details in parallel (batch request)
    const emailPromises = messages.map(async (message) => {
      const msgResponse = await gmail.users.messages.get({
        userId: 'me',
        id: message.id!,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });

      const msg = msgResponse.data;
      const headers = msg.payload?.headers || [];

      // Extract headers
      const fromHeader = headers.find((h) => h.name === 'From')?.value || '';
      const subject = headers.find((h) => h.name === 'Subject')?.value || '(no subject)';
      const dateHeader = headers.find((h) => h.name === 'Date')?.value || '';

      // Parse sender
      const sender = parseSender(fromHeader);

      // Parse date
      const receivedAt = dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString();

      // Get snippet
      const snippet = msg.snippet || '';

      // Get labels
      const labels = msg.labelIds || [];

      // Check for attachments
      const hasAttachments = (msg.payload?.parts || []).some(
        (part) => part.filename && part.filename.length > 0
      );

      return {
        id: msg.id!,
        from: sender.email,
        fromName: sender.name,
        subject,
        snippet,
        receivedAt,
        labels,
        hasAttachments,
      };
    });

    // Wait for all emails to be fetched
    const emails = await Promise.all(emailPromises);

    // Sort by date (newest first)
    emails.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());

    return emails;
  } catch (error: any) {
    // Handle Gmail API errors
    if (error.code === 429) {
      throw new Error('Gmail API rate limit exceeded. Please try again later.');
    }

    if (error.code === 403) {
      throw new Error('Insufficient Gmail permissions. Please re-authenticate.');
    }

    throw new Error(`Failed to fetch emails: ${error.message}`);
  }
}

/**
 * Extract plain text body from Gmail message payload
 */
function extractEmailBody(payload: any): string {
  let body = '';

  // Check if payload has parts (multipart email)
  if (payload.parts) {
    for (const part of payload.parts) {
      // Look for text/plain part
      if (part.mimeType === 'text/plain' && part.body?.data) {
        const decoded = Buffer.from(part.body.data, 'base64').toString('utf-8');
        body += decoded;
      }
      // Recursively check nested parts
      else if (part.parts) {
        body += extractEmailBody(part);
      }
      // Fallback to text/html if no plain text
      else if (!body && part.mimeType === 'text/html' && part.body?.data) {
        const decoded = Buffer.from(part.body.data, 'base64').toString('utf-8');
        // Simple HTML tag removal
        body += decoded.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }
  }
  // Single part email
  else if (payload.body?.data) {
    const decoded = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    if (payload.mimeType === 'text/html') {
      body = decoded.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    } else {
      body = decoded;
    }
  }

  return body.trim() || '(No body content)';
}

/**
 * Fetch recent emails with full body content
 *
 * @param auth - OAuth2Client with Gmail access
 * @param dateRange - Date range to fetch
 * @param maxResults - Maximum number of emails to fetch
 * @returns Array of emails with full body text
 */
export async function fetchRecentEmailsWithBody(
  auth: OAuth2Client,
  dateRange: DateRange = 'yesterday',
  maxResults: number = 100
): Promise<Array<EmailMetadata & { body: string }>> {
  const gmail = google.gmail({ version: 'v1', auth });

  // Build Gmail query
  const afterDate = getDateForRange(dateRange);
  const query = `after:${afterDate} -in:spam -in:trash -in:sent`;

  try {
    // List message IDs
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
    });

    const messages = listResponse.data.messages || [];

    if (messages.length === 0) {
      return [];
    }

    // Fetch message details with full body
    const emailPromises = messages.map(async (message) => {
      const msgResponse = await gmail.users.messages.get({
        userId: 'me',
        id: message.id!,
        format: 'full', // Get full message including body
      });

      const msg = msgResponse.data;
      const headers = msg.payload?.headers || [];

      // Extract headers
      const fromHeader = headers.find((h) => h.name === 'From')?.value || '';
      const subject = headers.find((h) => h.name === 'Subject')?.value || '(no subject)';
      const dateHeader = headers.find((h) => h.name === 'Date')?.value || '';

      // Parse sender
      const sender = parseSender(fromHeader);

      // Parse date
      const receivedAt = dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString();

      // Extract body
      let body = extractEmailBody(msg.payload);

      // Get snippet
      const snippet = msg.snippet || '';

      // Get labels
      const labels = msg.labelIds || [];

      // Check for attachments
      const hasAttachments = (msg.payload?.parts || []).some(
        (part) => part.filename && part.filename.length > 0
      );

      // Extract and append attachment text if attachments exist
      if (hasAttachments) {
        try {
          const attachmentText = await getAttachmentText(auth, msg.id!, msg.payload);
          if (attachmentText) {
            body += attachmentText;
          }
        } catch (error: any) {
          console.error(`Failed to extract attachments for email ${msg.id}:`, error.message);
          // Continue without attachment text
        }
      }

      return {
        id: msg.id!,
        from: sender.email,
        fromName: sender.name,
        subject,
        snippet,
        body,
        receivedAt,
        labels,
        hasAttachments,
      };
    });

    // Wait for all emails to be fetched
    const emails = await Promise.all(emailPromises);

    // Sort by date (newest first)
    emails.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());

    return emails;
  } catch (error: any) {
    // Handle Gmail API errors
    if (error.code === 429) {
      throw new Error('Gmail API rate limit exceeded. Please try again later.');
    }

    if (error.code === 403) {
      throw new Error('Insufficient Gmail permissions. Please re-authenticate.');
    }

    throw new Error(`Failed to fetch emails: ${error.message}`);
  }
}

/**
 * Get total unread email count
 *
 * @param auth - OAuth2Client with Gmail access
 * @returns Number of unread emails
 */
export async function getUnreadCount(auth: OAuth2Client): Promise<number> {
  const gmail = google.gmail({ version: 'v1', auth });

  try {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread -in:spam -in:trash',
      maxResults: 1, // We only need the count
    });

    return response.data.resultSizeEstimate || 0;
  } catch (error: any) {
    console.error('Failed to get unread count:', error.message);
    return 0;
  }
}
