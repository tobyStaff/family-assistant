// src/utils/emailStorageService.ts

import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { DateRange } from './inboxFetcher.js';
import { getAttachmentText } from './attachmentExtractor.js';
import {
  createEmail,
  markEmailProcessed,
  markEmailLabeled,
  getUnlabeledEmails,
  emailExists,
  recordFetchError,
  type CreateEmailInput,
} from '../db/emailDb.js';
import {
  getUnprocessedMessageIds,
  applyProcessedLabel,
} from './gmailLabelManager.js';

/**
 * Result of email fetch and store operation
 */
export interface FetchAndStoreResult {
  fetched: number;
  stored: number;
  labeled: number;
  skipped: number;
  errors: number;
  errorMessages: string[];
}

/**
 * Extract sender name and email from Gmail 'From' header
 */
function parseSender(fromHeader: string): { name: string; email: string } {
  const match = fromHeader.match(/^(.+?)\s*<(.+?)>$/);

  if (match) {
    return {
      name: match[1]?.trim().replace(/^["']|["']$/g, '') || fromHeader.trim(),
      email: match[2]?.trim() || fromHeader.trim(),
    };
  }

  return {
    name: fromHeader.trim(),
    email: fromHeader.trim(),
  };
}

/**
 * Extract plain text body from Gmail message payload
 */
function extractEmailBody(payload: any): string {
  let body = '';

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        const decoded = Buffer.from(part.body.data, 'base64').toString('utf-8');
        body += decoded;
      } else if (part.parts) {
        body += extractEmailBody(part);
      } else if (!body && part.mimeType === 'text/html' && part.body?.data) {
        const decoded = Buffer.from(part.body.data, 'base64').toString('utf-8');
        body += decoded.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }
  } else if (payload.body?.data) {
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
 * Fetch a single email's full content from Gmail
 */
async function fetchEmailContent(
  auth: OAuth2Client,
  messageId: string
): Promise<{
  gmailMessageId: string;
  gmailThreadId?: string;
  fromEmail: string;
  fromName?: string;
  subject: string;
  date: Date;
  bodyText: string;
  snippet?: string;
  labels: string[];
  hasAttachments: boolean;
  attachmentContent?: string;
}> {
  const gmail = google.gmail({ version: 'v1', auth });

  const msgResponse = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
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
  const date = dateHeader ? new Date(dateHeader) : new Date();

  // Extract body
  let bodyText = extractEmailBody(msg.payload);

  // Get snippet
  const snippet = msg.snippet || '';

  // Get labels
  const labels = msg.labelIds || [];

  // Check for attachments
  const hasAttachments = (msg.payload?.parts || []).some(
    (part: any) => part.filename && part.filename.length > 0
  );

  // Extract attachment text if present
  let attachmentContent: string | undefined;
  if (hasAttachments) {
    try {
      const attachmentText = await getAttachmentText(auth, msg.id!, msg.payload);
      if (attachmentText) {
        attachmentContent = attachmentText;
        // Also append to body for combined content
        bodyText += attachmentText;
      }
    } catch (error: any) {
      console.error(`Failed to extract attachments for email ${msg.id}:`, error.message);
    }
  }

  return {
    gmailMessageId: msg.id!,
    gmailThreadId: msg.threadId || undefined,
    fromEmail: sender.email,
    fromName: sender.name !== sender.email ? sender.name : undefined,
    subject,
    date,
    bodyText,
    snippet,
    labels,
    hasAttachments,
    attachmentContent,
  };
}

/**
 * Fetch unprocessed emails from Gmail and store in database
 *
 * @param userId - User ID
 * @param auth - OAuth2Client with Gmail access
 * @param dateRange - Date range to fetch (default: last3days)
 * @param maxResults - Maximum emails to fetch (default: 500)
 * @returns Statistics about the operation
 */
export async function fetchAndStoreEmails(
  userId: string,
  auth: OAuth2Client,
  dateRange: DateRange = 'last3days',
  maxResults: number = 500
): Promise<FetchAndStoreResult> {
  const result: FetchAndStoreResult = {
    fetched: 0,
    stored: 0,
    labeled: 0,
    skipped: 0,
    errors: 0,
    errorMessages: [],
  };

  console.log(`[EmailStorage] Starting fetch for user ${userId}, range: ${dateRange}, max: ${maxResults}`);

  try {
    // Step 1: Get unprocessed message IDs from Gmail
    const messageIds = await getUnprocessedMessageIds(auth, dateRange, maxResults);
    result.fetched = messageIds.length;

    console.log(`[EmailStorage] Found ${messageIds.length} unprocessed emails in Gmail`);

    if (messageIds.length === 0) {
      console.log('[EmailStorage] No new emails to process');
      return result;
    }

    // Step 2: Fetch and store each email
    const processedGmailIds: string[] = [];

    for (const messageId of messageIds) {
      try {
        // Check if already in DB
        if (emailExists(userId, messageId)) {
          console.log(`[EmailStorage] Email ${messageId} already exists, skipping`);
          result.skipped++;
          continue;
        }

        // Fetch full email content
        const emailContent = await fetchEmailContent(auth, messageId);

        // Store in database
        const emailInput: CreateEmailInput = {
          gmail_message_id: emailContent.gmailMessageId,
          gmail_thread_id: emailContent.gmailThreadId,
          from_email: emailContent.fromEmail,
          from_name: emailContent.fromName,
          subject: emailContent.subject,
          date: emailContent.date,
          body_text: emailContent.bodyText,
          snippet: emailContent.snippet,
          labels: emailContent.labels,
          has_attachments: emailContent.hasAttachments,
          attachment_content: emailContent.attachmentContent,
        };

        const emailId = createEmail(userId, emailInput);

        // Mark as processed in DB
        markEmailProcessed(userId, emailId);

        result.stored++;
        processedGmailIds.push(emailContent.gmailMessageId);

        console.log(`[EmailStorage] Stored email ${messageId}: "${emailContent.subject}"`);
      } catch (error: any) {
        result.errors++;
        const errorMsg = `Failed to process email ${messageId}: ${error.message}`;
        result.errorMessages.push(errorMsg);
        console.error(`[EmailStorage] ${errorMsg}`);

        // Record error in DB if email was partially created
        try {
          recordFetchError(userId, messageId, error.message);
        } catch {
          // Email may not exist in DB yet
        }
      }
    }

    // Step 3: Apply PROCESSED label to emails in Gmail
    if (processedGmailIds.length > 0) {
      console.log(`[EmailStorage] Applying PROCESSED label to ${processedGmailIds.length} emails in Gmail`);

      const labelResult = await applyProcessedLabel(auth, processedGmailIds);
      result.labeled = labelResult.success;

      if (labelResult.success > 0) {
        // Mark as labeled in DB
        const unlabeledEmails = getUnlabeledEmails(userId);
        for (const email of unlabeledEmails) {
          if (processedGmailIds.includes(email.gmail_message_id)) {
            markEmailLabeled(userId, email.id);
          }
        }
      }

      if (labelResult.failed > 0) {
        result.errorMessages.push(`Failed to label ${labelResult.failed} emails in Gmail`);
      }
    }

    console.log(`[EmailStorage] Complete - Stored: ${result.stored}, Skipped: ${result.skipped}, Errors: ${result.errors}, Labeled: ${result.labeled}`);

    return result;
  } catch (error: any) {
    result.errors++;
    result.errorMessages.push(`Fatal error: ${error.message}`);
    console.error(`[EmailStorage] Fatal error:`, error);
    return result;
  }
}

/**
 * Sync PROCESSED labels for emails that are in DB but not labeled in Gmail
 * This handles cases where labeling failed previously
 *
 * @param userId - User ID
 * @param auth - OAuth2Client
 * @returns Number of emails labeled
 */
export async function syncProcessedLabels(
  userId: string,
  auth: OAuth2Client
): Promise<{ labeled: number; failed: number }> {
  const unlabeledEmails = getUnlabeledEmails(userId);

  if (unlabeledEmails.length === 0) {
    return { labeled: 0, failed: 0 };
  }

  console.log(`[EmailStorage] Syncing labels for ${unlabeledEmails.length} unlabeled emails`);

  const gmailIds = unlabeledEmails.map((e) => e.gmail_message_id);
  const result = await applyProcessedLabel(auth, gmailIds);

  // Mark successful ones in DB
  if (result.success > 0) {
    for (const email of unlabeledEmails) {
      markEmailLabeled(userId, email.id);
    }
  }

  return { labeled: result.success, failed: result.failed };
}
