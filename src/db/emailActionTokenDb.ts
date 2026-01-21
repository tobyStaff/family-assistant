// src/db/emailActionTokenDb.ts

import { randomUUID } from 'crypto';
import db from './db.js';

/**
 * Action types for email tokens
 */
export type ActionType = 'complete_todo' | 'remove_event';

/**
 * Token record from database
 */
export interface ActionToken {
  id: number;
  token: string;
  user_id: string;
  action_type: ActionType;
  target_id: number;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

/**
 * Result of validating and using a token
 */
export interface TokenValidationResult {
  valid: boolean;
  userId?: string;
  actionType?: ActionType;
  targetId?: number;
  error?: string;
}

/**
 * Create an action token for email links
 * Token expires in 7 days by default
 */
export function createActionToken(
  userId: string,
  actionType: ActionType,
  targetId: number,
  expiresInDays: number = 7
): string {
  const token = randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  db.prepare(`
    INSERT INTO email_action_tokens (token, user_id, action_type, target_id, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, userId, actionType, targetId, expiresAt.toISOString());

  return token;
}

/**
 * Validate a token and mark it as used if valid
 * Returns validation result with user/action info or error
 */
export function validateAndUseToken(token: string): TokenValidationResult {
  const row = db.prepare(`
    SELECT id, user_id, action_type, target_id, expires_at, used_at
    FROM email_action_tokens
    WHERE token = ?
  `).get(token) as {
    id: number;
    user_id: string;
    action_type: ActionType;
    target_id: number;
    expires_at: string;
    used_at: string | null;
  } | undefined;

  if (!row) {
    return { valid: false, error: 'Token not found' };
  }

  // Check if already used
  if (row.used_at) {
    return { valid: false, error: 'Token has already been used' };
  }

  // Check if expired
  const expiresAt = new Date(row.expires_at);
  if (expiresAt < new Date()) {
    return { valid: false, error: 'Token has expired' };
  }

  // Mark token as used
  db.prepare(`
    UPDATE email_action_tokens
    SET used_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(row.id);

  return {
    valid: true,
    userId: row.user_id,
    actionType: row.action_type,
    targetId: row.target_id,
  };
}

/**
 * Get token info without using it (for debugging/display)
 */
export function getTokenInfo(token: string): ActionToken | null {
  const row = db.prepare(`
    SELECT id, token, user_id, action_type, target_id, expires_at, used_at, created_at
    FROM email_action_tokens
    WHERE token = ?
  `).get(token) as {
    id: number;
    token: string;
    user_id: string;
    action_type: ActionType;
    target_id: number;
    expires_at: string;
    used_at: string | null;
    created_at: string;
  } | undefined;

  if (!row) return null;

  return {
    id: row.id,
    token: row.token,
    user_id: row.user_id,
    action_type: row.action_type,
    target_id: row.target_id,
    expires_at: new Date(row.expires_at),
    used_at: row.used_at ? new Date(row.used_at) : null,
    created_at: new Date(row.created_at),
  };
}

/**
 * Cleanup expired tokens (should be run periodically)
 * Returns number of tokens deleted
 */
export function cleanupExpiredTokens(): number {
  const result = db.prepare(`
    DELETE FROM email_action_tokens
    WHERE expires_at < CURRENT_TIMESTAMP
  `).run();

  return result.changes;
}

/**
 * Delete all tokens for a specific target
 * Useful when todo/event is deleted
 */
export function deleteTokensForTarget(actionType: ActionType, targetId: number): number {
  const result = db.prepare(`
    DELETE FROM email_action_tokens
    WHERE action_type = ? AND target_id = ?
  `).run(actionType, targetId);

  return result.changes;
}
