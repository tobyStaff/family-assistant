// src/utils/gmailLabelManager.ts

import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { DateRange } from './inboxFetcher.js';

const PROCESSED_LABEL_NAME = 'PROCESSED';

/**
 * Ensure PROCESSED label exists, create if not
 *
 * @param auth - OAuth2 client
 * @returns Label ID
 */
export async function ensureProcessedLabel(auth: OAuth2Client): Promise<string> {
  const gmail = google.gmail({ version: 'v1', auth });

  try {
    // List all labels
    const labelsResponse = await gmail.users.labels.list({ userId: 'me' });
    const labels = labelsResponse.data.labels || [];

    // Find PROCESSED label
    const existingLabel = labels.find((label) => label.name === PROCESSED_LABEL_NAME);

    if (existingLabel && existingLabel.id) {
      console.log(`PROCESSED label exists with ID: ${existingLabel.id}`);
      return existingLabel.id;
    }

    // Create label if doesn't exist
    console.log('Creating PROCESSED label...');
    const createResponse = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: PROCESSED_LABEL_NAME,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      },
    });

    const labelId = createResponse.data.id!;
    console.log(`PROCESSED label created with ID: ${labelId}`);
    return labelId;
  } catch (error: any) {
    console.error('Error ensuring PROCESSED label:', error.message);
    // If creation fails, continue without label (as per user requirement)
    throw error;
  }
}

/**
 * Apply PROCESSED label to messages
 *
 * @param auth - OAuth2 client
 * @param messageIds - Array of Gmail message IDs
 * @returns Number of successfully labeled messages
 */
export async function applyProcessedLabel(
  auth: OAuth2Client,
  messageIds: string[]
): Promise<{ success: number; failed: number }> {
  if (messageIds.length === 0) {
    return { success: 0, failed: 0 };
  }

  const gmail = google.gmail({ version: 'v1', auth });

  try {
    // Get or create label
    const labelId = await ensureProcessedLabel(auth);

    // Batch modify (Gmail API supports up to 1000 messages per request)
    const batchSize = 1000;
    let success = 0;
    let failed = 0;

    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);

      try {
        await gmail.users.messages.batchModify({
          userId: 'me',
          requestBody: {
            ids: batch,
            addLabelIds: [labelId],
          },
        });

        success += batch.length;
        console.log(`Applied PROCESSED label to ${batch.length} messages`);
      } catch (error: any) {
        console.error(`Failed to label batch of ${batch.length} messages:`, error.message);
        failed += batch.length;
      }
    }

    return { success, failed };
  } catch (error: any) {
    console.error('Error applying PROCESSED label:', error.message);
    return { success: 0, failed: messageIds.length };
  }
}

/**
 * Remove PROCESSED label from messages
 *
 * @param auth - OAuth2 client
 * @param messageIds - Array of Gmail message IDs
 * @returns Number of successfully unlabeled messages
 */
export async function removeProcessedLabel(
  auth: OAuth2Client,
  messageIds: string[]
): Promise<{ success: number; failed: number }> {
  if (messageIds.length === 0) {
    return { success: 0, failed: 0 };
  }

  const gmail = google.gmail({ version: 'v1', auth });

  try {
    // Get label ID
    const labelId = await ensureProcessedLabel(auth);

    // Batch modify
    const batchSize = 1000;
    let success = 0;
    let failed = 0;

    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);

      try {
        await gmail.users.messages.batchModify({
          userId: 'me',
          requestBody: {
            ids: batch,
            removeLabelIds: [labelId],
          },
        });

        success += batch.length;
        console.log(`Removed PROCESSED label from ${batch.length} messages`);
      } catch (error: any) {
        console.error(`Failed to unlabel batch of ${batch.length} messages:`, error.message);
        failed += batch.length;
      }
    }

    return { success, failed };
  } catch (error: any) {
    console.error('Error removing PROCESSED label:', error.message);
    return { success: 0, failed: messageIds.length };
  }
}

/**
 * Get unprocessed message IDs from Gmail (messages without PROCESSED label)
 *
 * @param auth - OAuth2 client
 * @param dateRange - Date range to fetch
 * @param maxResults - Max number of messages
 * @returns Array of Gmail message IDs
 */
export async function getUnprocessedMessageIds(
  auth: OAuth2Client,
  dateRange: DateRange = 'last3days',
  maxResults: number = 500
): Promise<string[]> {
  const gmail = google.gmail({ version: 'v1', auth });

  // Build Gmail query to exclude PROCESSED label
  const afterDate = getDateForRange(dateRange);
  const query = `after:${afterDate} -in:spam -in:trash -in:sent -label:${PROCESSED_LABEL_NAME}`;

  try {
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
    });

    const messages = listResponse.data.messages || [];
    return messages.map((msg) => msg.id!);
  } catch (error: any) {
    console.error('Error getting unprocessed message IDs:', error.message);
    throw error;
  }
}

/**
 * Helper to get date string for Gmail query
 * (Copied from inboxFetcher.ts)
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
