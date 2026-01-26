// src/lib/userContext.ts
import type { FastifyRequest } from 'fastify';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { getAuth, updateAccessToken } from '../db/authDb.js';
import { decrypt, encrypt } from './crypto.js';

/**
 * Extract user ID from authenticated request
 * Requires session middleware to have run first
 *
 * If impersonation is active (SUPER_ADMIN viewing as another user),
 * returns the impersonated user's ID instead.
 *
 * @param request - Fastify request
 * @returns User ID (or impersonated user ID if active)
 * @throws Error if not authenticated
 */
export function getUserId(request: FastifyRequest): string {
  const userId = (request as any).userId;

  if (!userId) {
    throw new Error('User not authenticated - missing session');
  }

  // If impersonating another user, return their ID instead
  const impersonatingUserId = (request as any).impersonatingUserId;
  if (impersonatingUserId) {
    return impersonatingUserId;
  }

  return userId;
}

/**
 * Get the real user ID (ignores impersonation)
 * Use this when you need the actual logged-in admin's ID
 *
 * @param request - Fastify request
 * @returns Real user ID (never impersonated)
 * @throws Error if not authenticated
 */
export function getRealUserId(request: FastifyRequest): string {
  const userId = (request as any).userId;

  if (!userId) {
    throw new Error('User not authenticated - missing session');
  }

  return userId;
}

/**
 * Check if current request is in impersonation mode
 *
 * @param request - Fastify request
 * @returns True if impersonating another user
 */
export function isImpersonating(request: FastifyRequest): boolean {
  return !!(request as any).impersonatingUserId;
}

/**
 * Get OAuth2Client for authenticated user with auto-refresh
 * Handles token decryption and automatic refresh when expired
 *
 * @param request - Fastify request
 * @returns Configured OAuth2Client
 * @throws Error if not authenticated or auth not found
 */
export async function getUserAuth(request: FastifyRequest): Promise<OAuth2Client> {
  const userId = getUserId(request);

  // Fetch encrypted tokens from database
  const authEntry = getAuth(userId);
  if (!authEntry) {
    throw new Error(`No auth found for user ${userId}`);
  }

  // Decrypt tokens (stored as "iv:content")
  const refreshToken = decryptToken(authEntry.refresh_token);
  const accessToken = authEntry.access_token
    ? decryptToken(authEntry.access_token)
    : undefined;

  // Create OAuth2Client
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
    access_token: accessToken ?? null,
    expiry_date: authEntry.expiry_date?.getTime() ?? null,
  });

  // Auto-refresh if token is expired or will expire soon
  if (isTokenExpired(authEntry.expiry_date)) {
    await refreshAccessToken(oauth2Client, userId);
  }

  return oauth2Client;
}

/**
 * Decrypt token stored as "iv:content" format
 *
 * @param encryptedData - Encrypted token in "iv:content" format
 * @returns Decrypted token
 */
function decryptToken(encryptedData: string): string {
  const [iv, content] = encryptedData.split(':');
  if (!iv || !content) {
    throw new Error('Invalid encrypted token format');
  }
  return decrypt(content, iv);
}

/**
 * Check if token is expired or will expire soon (5min buffer)
 *
 * @param expiryDate - Token expiry date
 * @returns True if expired or will expire soon
 */
function isTokenExpired(expiryDate?: Date): boolean {
  if (!expiryDate) return true;

  const bufferMs = 5 * 60 * 1000; // 5 minutes
  return expiryDate.getTime() - bufferMs < Date.now();
}

/**
 * Refresh access token using refresh token
 * Updates database with new access token and expiry
 *
 * @param oauth2Client - OAuth2Client with refresh_token set
 * @param userId - User ID
 */
async function refreshAccessToken(
  oauth2Client: OAuth2Client,
  userId: string
): Promise<void> {
  try {
    const { credentials } = await oauth2Client.refreshAccessToken();

    if (credentials.access_token && credentials.expiry_date) {
      // Encrypt new access token
      const encrypted = encrypt(credentials.access_token);
      const encryptedData = `${encrypted.iv}:${encrypted.content}`;

      // Update database
      updateAccessToken(
        userId,
        encryptedData,
        new Date(credentials.expiry_date)
      );

      console.log(`Token refreshed for user ${userId}`);
    }
  } catch (error: any) {
    // Check for revoked token error
    if (error.message?.includes('invalid_grant')) {
      throw new Error('Token revoked - please log in again');
    }
    throw error;
  }
}
