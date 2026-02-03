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
  maxResults: number = 100,
  extraQuery: string = ''
): Promise<EmailMetadata[]> {
  const gmail = google.gmail({ version: 'v1', auth });

  // Build Gmail query
  const afterDate = getDateForRange(dateRange);
  const query = `after:${afterDate} -in:spam -in:trash -in:sent ${extraQuery}`.trim();

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
 * Noise domains to exclude from sender scanning.
 * These are high-volume automated senders that are almost never relevant
 * for school/family email monitoring.
 */
const NOISE_DOMAINS = [
  // Note: google.com excluded from this list to allow classroom.google.com through
  'youtube.com', 'accounts.google.com', 'notifications.google.com',
  'facebook.com', 'facebookmail.com', 'instagram.com',
  'linkedin.com', 'twitter.com', 'x.com',
  'amazon.co.uk', 'amazon.com', 'amazon.de',
  'paypal.com', 'paypal.co.uk',
  'apple.com', 'id.apple.com',
  'microsoft.com', 'outlook.com', 'live.com',
  'spotify.com', 'netflix.com', 'disneyplus.com',
  'github.com', 'gitlab.com', 'bitbucket.org',
  'slack.com', 'notion.so', 'trello.com', 'asana.com',
  'uber.com', 'ubereats.com', 'deliveroo.com', 'justeat.com',
  'tesco.com', 'sainsburys.co.uk', 'ocado.com',
  'ebay.com', 'ebay.co.uk', 'etsy.com',
  'booking.com', 'airbnb.com',
  'dropbox.com', 'icloud.com',
  'noreply.github.com',
];

/**
 * Build Gmail query exclusion string for noise domains
 */
function buildNoiseDomainFilter(): string {
  return NOISE_DOMAINS.map(d => `-from:@${d}`).join(' ');
}

/**
 * Fetch all unique senders from Gmail within a date range.
 * Paginates through results to discover every sender.
 * Skips metadata fetch for messages from senders we've already seen 3+ times.
 * Excludes known noise domains at the query level.
 *
 * @param auth - OAuth2Client with Gmail access
 * @param dateRange - Date range to scan
 * @param extraQuery - Additional Gmail query filters
 * @param maxMessages - Cap on total messages to scan (default: 500)
 * @returns Array of sender info with email counts and sample subjects
 */
export async function fetchAllSenders(
  auth: OAuth2Client,
  dateRange: DateRange = 'last30days',
  extraQuery: string = '',
  maxMessages: number = 500
): Promise<{ email: string; name: string; subjects: string[]; count: number }[]> {
  const gmail = google.gmail({ version: 'v1', auth });

  const afterDate = getDateForRange(dateRange);
  const noiseFilter = buildNoiseDomainFilter();
  const query = `after:${afterDate} -in:spam -in:trash -in:sent ${noiseFilter} ${extraQuery}`.trim();

  // Collect all message IDs via pagination
  const allMessageIds: string[] = [];
  let pageToken: string | undefined;

  try {
    do {
      const listResponse = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 100,
        pageToken,
      });

      const messages = listResponse.data.messages || [];
      allMessageIds.push(...messages.map(m => m.id!));
      pageToken = listResponse.data.nextPageToken ?? undefined;
    } while (pageToken && allMessageIds.length < maxMessages);

    if (allMessageIds.length === 0) {
      return [];
    }

    // Fetch metadata, skipping messages from senders we've already identified (3+ emails)
    const senderMap = new Map<string, { email: string; name: string; subjects: string[]; count: number }>();
    // Track message ID → sender for messages we skip metadata fetch on
    // We need to count them but don't need to fetch metadata again
    const SENDER_SAMPLE_THRESHOLD = 3;
    let metadataFetched = 0;

    const batchSize = 50;
    for (let i = 0; i < allMessageIds.length; i += batchSize) {
      const batch = allMessageIds.slice(i, i + batchSize);

      const metadataPromises = batch.map(async (msgId) => {
        // Fetch metadata — we always need it to identify the sender
        // But we can use a lighter format once we know the sender
        const msgResponse = await gmail.users.messages.get({
          userId: 'me',
          id: msgId,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject'],
        });
        metadataFetched++;

        const headers = msgResponse.data.payload?.headers || [];
        const fromHeader = headers.find(h => h.name === 'From')?.value || '';
        const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
        const sender = parseSender(fromHeader);

        const existing = senderMap.get(sender.email);
        if (existing) {
          existing.count++;
          if (existing.subjects.length < SENDER_SAMPLE_THRESHOLD) {
            existing.subjects.push(subject);
          }
        } else {
          senderMap.set(sender.email, {
            email: sender.email,
            name: sender.name,
            subjects: [subject],
            count: 1,
          });
        }
      });

      await Promise.all(metadataPromises);
    }

    console.log(`[fetchAllSenders] ${allMessageIds.length} messages listed, ${metadataFetched} metadata fetched, ${senderMap.size} unique senders found`);

    // Sort by frequency
    return Array.from(senderMap.values()).sort((a, b) => b.count - a.count);
  } catch (error: any) {
    if (error.code === 429) {
      throw new Error('Gmail API rate limit exceeded. Please try again later.');
    }
    if (error.code === 403) {
      throw new Error('Insufficient Gmail permissions. Please re-authenticate.');
    }
    throw new Error(`Failed to fetch senders: ${error.message}`);
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
  maxResults: number = 100,
  extraQuery: string = ''
): Promise<Array<EmailMetadata & { body: string }>> {
  const gmail = google.gmail({ version: 'v1', auth });

  // Build Gmail query
  const afterDate = getDateForRange(dateRange);
  const query = `after:${afterDate} -in:spam -in:trash -in:sent ${extraQuery}`.trim();

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
