// src/db/trialDb.ts
// CRUD for 7-day trial tracking and onboarding email sequence.

import db from './db.js';

/**
 * Mark the trial as started for a user.
 * Called when the user generates their first briefing.
 */
export function setTrialStarted(userId: string): void {
  db.prepare(`
    UPDATE users
    SET trial_started_at = datetime('now'), updated_at = datetime('now')
    WHERE user_id = ? AND trial_started_at IS NULL
  `).run(userId);
}

/**
 * Get the datetime when the user's trial started, or null if not started.
 */
export function getTrialStartedAt(userId: string): Date | null {
  const row = db.prepare(`
    SELECT trial_started_at FROM users WHERE user_id = ?
  `).get(userId) as { trial_started_at: string | null } | undefined;

  if (!row?.trial_started_at) return null;
  return new Date(row.trial_started_at);
}

/**
 * Record that an onboarding sequence email has been sent.
 * Uses INSERT OR IGNORE to be idempotent.
 */
export function markOnboardingEmailSent(userId: string, day: number, emailType: string): void {
  db.prepare(`
    INSERT OR IGNORE INTO onboarding_emails_sent (user_id, day, email_type)
    VALUES (?, ?, ?)
  `).run(userId, day, emailType);
}

/**
 * Get all onboarding emails sent for a user.
 */
export function getOnboardingEmailsSent(userId: string): Array<{ day: number; email_type: string; sent_at: string }> {
  return db.prepare(`
    SELECT day, email_type, sent_at FROM onboarding_emails_sent WHERE user_id = ?
  `).all(userId) as Array<{ day: number; email_type: string; sent_at: string }>;
}

/**
 * Check whether a specific onboarding email has already been sent.
 */
export function hasOnboardingEmailBeenSent(userId: string, day: number, emailType: string): boolean {
  const row = db.prepare(`
    SELECT 1 FROM onboarding_emails_sent WHERE user_id = ? AND day = ? AND email_type = ?
  `).get(userId, day, emailType);
  return !!row;
}
