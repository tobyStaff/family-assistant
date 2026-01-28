// src/db/settingsDb.ts
import db from './db.js';
import type { UserSettings } from '../types/summary.js';
import { getUser } from './userDb.js';

/**
 * Email source type
 */
export type EmailSource = 'gmail' | 'hosted';

/**
 * Prepared statements for user settings operations
 */
const getSettingsStmt = db.prepare(`
  SELECT
    user_id,
    summary_email_recipients,
    summary_enabled,
    summary_time_utc,
    timezone,
    email_source,
    created_at,
    updated_at
  FROM user_settings
  WHERE user_id = ?
`);

const upsertSettingsStmt = db.prepare(`
  INSERT INTO user_settings (
    user_id,
    summary_email_recipients,
    summary_enabled,
    summary_time_utc,
    timezone,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(user_id) DO UPDATE SET
    summary_email_recipients = excluded.summary_email_recipients,
    summary_enabled = excluded.summary_enabled,
    summary_time_utc = excluded.summary_time_utc,
    timezone = excluded.timezone,
    updated_at = CURRENT_TIMESTAMP
`);

const deleteSettingsStmt = db.prepare(`
  DELETE FROM user_settings WHERE user_id = ?
`);

const getAllEnabledSettingsStmt = db.prepare(`
  SELECT
    user_id,
    summary_email_recipients,
    summary_enabled,
    summary_time_utc,
    timezone,
    email_source,
    created_at,
    updated_at
  FROM user_settings
  WHERE summary_enabled = 1
`);

/**
 * Parse database row to UserSettings object
 */
function parseRow(row: any): UserSettings & { email_source: EmailSource } {
  return {
    user_id: row.user_id,
    summary_email_recipients: row.summary_email_recipients
      ? JSON.parse(row.summary_email_recipients)
      : [],
    summary_enabled: Boolean(row.summary_enabled),
    summary_time_utc: row.summary_time_utc,
    timezone: row.timezone,
    email_source: (row.email_source as EmailSource) || 'gmail',
    created_at: row.created_at ? new Date(row.created_at) : undefined,
    updated_at: row.updated_at ? new Date(row.updated_at) : undefined,
  };
}

/**
 * Get user settings by user ID
 *
 * @param userId - User ID
 * @returns User settings or null if not found
 */
export function getSettings(userId: string): UserSettings | null {
  const row = getSettingsStmt.get(userId) as any;
  return row ? parseRow(row) : null;
}

/**
 * Create or update user settings
 *
 * @param settings - User settings to upsert
 */
export function upsertSettings(settings: UserSettings): void {
  upsertSettingsStmt.run(
    settings.user_id,
    JSON.stringify(settings.summary_email_recipients),
    settings.summary_enabled ? 1 : 0,
    settings.summary_time_utc,
    settings.timezone
  );
}

/**
 * Delete user settings
 *
 * @param userId - User ID
 * @returns True if settings were deleted
 */
export function deleteSettings(userId: string): boolean {
  const result = deleteSettingsStmt.run(userId);
  return result.changes > 0;
}

/**
 * Get all users with summaries enabled
 * Used by cron job to determine who should receive daily summaries
 *
 * @returns Array of user settings where summary_enabled = true
 */
export function getAllEnabledSettings(): UserSettings[] {
  const rows = getAllEnabledSettingsStmt.all() as any[];
  return rows.map(parseRow);
}

/**
 * Get or create default settings for a user
 * If settings don't exist, returns default values with user's own email as recipient
 *
 * @param userId - User ID
 * @returns User settings (existing or default)
 */
export function getOrCreateDefaultSettings(userId: string): UserSettings & { email_source: EmailSource } {
  const existing = getSettings(userId);
  if (existing) {
    return existing as UserSettings & { email_source: EmailSource };
  }

  // Get user's email to use as default recipient
  const user = getUser(userId);
  const defaultRecipients = user?.email ? [user.email] : [];

  // Return default settings (not saved to DB yet)
  return {
    user_id: userId,
    summary_email_recipients: defaultRecipients,
    summary_enabled: true,
    summary_time_utc: 8,
    timezone: 'UTC',
    email_source: 'gmail',
  };
}

// ============================================
// EMAIL SOURCE FUNCTIONS
// ============================================

const getEmailSourceStmt = db.prepare(`
  SELECT email_source FROM user_settings WHERE user_id = ?
`);

const setEmailSourceStmt = db.prepare(`
  UPDATE user_settings
  SET email_source = ?, updated_at = CURRENT_TIMESTAMP
  WHERE user_id = ?
`);

const insertEmailSourceStmt = db.prepare(`
  INSERT INTO user_settings (user_id, email_source, summary_enabled, summary_time_utc, timezone)
  VALUES (?, ?, 1, 8, 'UTC')
  ON CONFLICT(user_id) DO UPDATE SET
    email_source = excluded.email_source,
    updated_at = CURRENT_TIMESTAMP
`);

/**
 * Get email source for a user
 *
 * @param userId - User ID
 * @returns Email source ('gmail' or 'hosted'), defaults to 'gmail'
 */
export function getEmailSource(userId: string): EmailSource {
  const row = getEmailSourceStmt.get(userId) as { email_source: string } | undefined;
  return (row?.email_source as EmailSource) || 'gmail';
}

/**
 * Set email source for a user
 * Creates settings record if it doesn't exist
 *
 * @param userId - User ID
 * @param source - Email source ('gmail' or 'hosted')
 */
export function setEmailSource(userId: string, source: EmailSource): void {
  // Try update first
  const result = setEmailSourceStmt.run(source, userId);

  // If no rows updated, insert new settings record
  if (result.changes === 0) {
    insertEmailSourceStmt.run(userId, source);
  }
}

/**
 * Check if user is using hosted email
 *
 * @param userId - User ID
 * @returns true if using hosted email
 */
export function isUsingHostedEmail(userId: string): boolean {
  return getEmailSource(userId) === 'hosted';
}

/**
 * Check if user is using Gmail
 *
 * @param userId - User ID
 * @returns true if using Gmail
 */
export function isUsingGmail(userId: string): boolean {
  return getEmailSource(userId) === 'gmail';
}
