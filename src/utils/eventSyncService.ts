// src/utils/eventSyncService.ts

import type { OAuth2Client } from 'google-auth-library';
import { getPendingSyncEvents } from '../db/eventDb.js';
import { syncEventsToCalendar } from './calendarIntegration.js';

/**
 * Sync pending events for a specific user
 *
 * @param userId - User ID
 * @param auth - OAuth2 client
 * @param maxRetries - Maximum number of retries (default: 5)
 * @returns Sync statistics
 */
export async function syncPendingEventsForUser(
  userId: string,
  auth: OAuth2Client,
  maxRetries: number = 5
): Promise<{
  processed: number;
  synced: number;
  failed: number;
}> {
  // Get pending/failed events that haven't exceeded retry limit
  const pendingEvents = getPendingSyncEvents(userId, maxRetries);

  if (pendingEvents.length === 0) {
    return { processed: 0, synced: 0, failed: 0 };
  }

  console.log(`Found ${pendingEvents.length} pending events for user ${userId}`);

  // Extract event IDs
  const eventIds = pendingEvents.map((e) => e.id);

  // Sync to Google Calendar
  const syncResult = await syncEventsToCalendar(userId, auth, eventIds);

  return {
    processed: pendingEvents.length,
    synced: syncResult.synced,
    failed: syncResult.failed,
  };
}

/**
 * Calculate exponential backoff delay for retry attempts
 *
 * @param retryCount - Number of previous retries
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(retryCount: number): number {
  const baseDelay = 60 * 1000; // 1 minute
  const delay = baseDelay * Math.pow(2, retryCount); // Exponential: 1min, 2min, 4min, 8min, 16min...
  const maxDelay = 60 * 60 * 1000; // Cap at 1 hour
  return Math.min(delay, maxDelay);
}

/**
 * Get human-readable time until next retry
 *
 * @param retryCount - Current retry count
 * @returns Human-readable string
 */
export function getNextRetryTime(retryCount: number): string {
  const delay = calculateBackoffDelay(retryCount);
  const minutes = Math.floor(delay / (1000 * 60));

  if (minutes < 60) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours !== 1 ? 's' : ''}`;
}
