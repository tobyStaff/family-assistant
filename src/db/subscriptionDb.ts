// src/db/subscriptionDb.ts

import db from './db.js';
import type {
  SubscriptionTier,
  SubscriptionStatus,
  UserSubscription,
} from '../types/subscription.js';

/**
 * Raw subscription row from database
 */
interface SubscriptionRow {
  user_id: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: number;
  trial_end: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Convert database row to UserSubscription object
 */
function rowToSubscription(row: SubscriptionRow): UserSubscription {
  return {
    userId: row.user_id,
    tier: row.tier,
    status: row.status,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    currentPeriodStart: row.current_period_start ? new Date(row.current_period_start) : null,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end) : null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    trialEnd: row.trial_end ? new Date(row.trial_end) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Get subscription for a user
 *
 * @param userId - User ID
 * @returns Subscription record or null if not found
 */
export function getSubscription(userId: string): UserSubscription | null {
  const row = db.prepare(`
    SELECT * FROM subscriptions WHERE user_id = ?
  `).get(userId) as SubscriptionRow | undefined;

  return row ? rowToSubscription(row) : null;
}

/**
 * Get user's subscription tier (shorthand)
 *
 * @param userId - User ID
 * @returns Subscription tier (defaults to FREE if not found)
 */
export function getUserTier(userId: string): SubscriptionTier {
  const row = db.prepare(`
    SELECT tier FROM subscriptions WHERE user_id = ?
  `).get(userId) as { tier: SubscriptionTier } | undefined;

  return row?.tier || 'FREE';
}

/**
 * Check if user's subscription is active (active or trialing)
 *
 * @param userId - User ID
 * @returns true if subscription is active
 */
export function isSubscriptionActive(userId: string): boolean {
  const row = db.prepare(`
    SELECT status FROM subscriptions WHERE user_id = ?
  `).get(userId) as { status: SubscriptionStatus } | undefined;

  if (!row) return true; // No subscription = FREE tier, always active

  return row.status === 'active' || row.status === 'trialing';
}

/**
 * Ensure subscription record exists for user (creates FREE tier if missing)
 *
 * @param userId - User ID
 * @returns Created or existing subscription
 */
export function ensureSubscription(userId: string): UserSubscription {
  const existing = getSubscription(userId);
  if (existing) return existing;

  db.prepare(`
    INSERT INTO subscriptions (user_id, tier, status)
    VALUES (?, 'FREE', 'active')
  `).run(userId);

  return getSubscription(userId)!;
}

/**
 * Update user's subscription tier
 *
 * @param userId - User ID
 * @param tier - New subscription tier
 */
export function updateUserTier(userId: string, tier: SubscriptionTier): void {
  db.prepare(`
    UPDATE subscriptions
    SET tier = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).run(tier, userId);
}

/**
 * Upsert subscription with full Stripe data
 *
 * @param data - Subscription data
 */
export function upsertSubscription(data: {
  userId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  trialEnd?: Date | null;
}): void {
  db.prepare(`
    INSERT INTO subscriptions (
      user_id,
      tier,
      status,
      stripe_customer_id,
      stripe_subscription_id,
      current_period_start,
      current_period_end,
      cancel_at_period_end,
      trial_end
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      tier = excluded.tier,
      status = excluded.status,
      stripe_customer_id = COALESCE(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
      stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, subscriptions.stripe_subscription_id),
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end,
      trial_end = excluded.trial_end,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    data.userId,
    data.tier,
    data.status,
    data.stripeCustomerId ?? null,
    data.stripeSubscriptionId ?? null,
    data.currentPeriodStart?.toISOString() ?? null,
    data.currentPeriodEnd?.toISOString() ?? null,
    data.cancelAtPeriodEnd ? 1 : 0,
    data.trialEnd?.toISOString() ?? null
  );
}

/**
 * Update subscription status
 *
 * @param userId - User ID
 * @param status - New subscription status
 */
export function updateSubscriptionStatus(userId: string, status: SubscriptionStatus): void {
  db.prepare(`
    UPDATE subscriptions
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).run(status, userId);
}

/**
 * Update Stripe customer ID for a user
 *
 * @param userId - User ID
 * @param stripeCustomerId - Stripe customer ID
 */
export function updateStripeCustomerId(userId: string, stripeCustomerId: string): void {
  db.prepare(`
    UPDATE subscriptions
    SET stripe_customer_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).run(stripeCustomerId, userId);
}

/**
 * Get subscription by Stripe customer ID
 *
 * @param stripeCustomerId - Stripe customer ID
 * @returns Subscription record or null
 */
export function getSubscriptionByStripeCustomerId(stripeCustomerId: string): UserSubscription | null {
  const row = db.prepare(`
    SELECT * FROM subscriptions WHERE stripe_customer_id = ?
  `).get(stripeCustomerId) as SubscriptionRow | undefined;

  return row ? rowToSubscription(row) : null;
}

/**
 * Get subscription by Stripe subscription ID
 *
 * @param stripeSubscriptionId - Stripe subscription ID
 * @returns Subscription record or null
 */
export function getSubscriptionByStripeSubscriptionId(stripeSubscriptionId: string): UserSubscription | null {
  const row = db.prepare(`
    SELECT * FROM subscriptions WHERE stripe_subscription_id = ?
  `).get(stripeSubscriptionId) as SubscriptionRow | undefined;

  return row ? rowToSubscription(row) : null;
}

/**
 * Mark subscription as canceling at period end
 *
 * @param userId - User ID
 * @param cancelAtPeriodEnd - Whether to cancel at period end
 */
export function setCancelAtPeriodEnd(userId: string, cancelAtPeriodEnd: boolean): void {
  db.prepare(`
    UPDATE subscriptions
    SET cancel_at_period_end = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).run(cancelAtPeriodEnd ? 1 : 0, userId);
}

/**
 * Update subscription period dates
 *
 * @param userId - User ID
 * @param currentPeriodStart - Period start date
 * @param currentPeriodEnd - Period end date
 */
export function updateSubscriptionPeriod(
  userId: string,
  currentPeriodStart: Date,
  currentPeriodEnd: Date
): void {
  db.prepare(`
    UPDATE subscriptions
    SET
      current_period_start = ?,
      current_period_end = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).run(
    currentPeriodStart.toISOString(),
    currentPeriodEnd.toISOString(),
    userId
  );
}

/**
 * Get all subscriptions with a specific status (for admin/reporting)
 *
 * @param status - Subscription status to filter by
 * @returns Array of subscriptions
 */
export function getSubscriptionsByStatus(status: SubscriptionStatus): UserSubscription[] {
  const rows = db.prepare(`
    SELECT * FROM subscriptions WHERE status = ?
  `).all(status) as SubscriptionRow[];

  return rows.map(rowToSubscription);
}

/**
 * Get subscription statistics (for admin dashboard)
 *
 * @returns Statistics about subscriptions
 */
export function getSubscriptionStats(): {
  totalUsers: number;
  byTier: Record<SubscriptionTier, number>;
  byStatus: Record<SubscriptionStatus, number>;
} {
  const tierCounts = db.prepare(`
    SELECT tier, COUNT(*) as count FROM subscriptions GROUP BY tier
  `).all() as { tier: SubscriptionTier; count: number }[];

  const statusCounts = db.prepare(`
    SELECT status, COUNT(*) as count FROM subscriptions GROUP BY status
  `).all() as { status: SubscriptionStatus; count: number }[];

  const totalUsers = db.prepare(`
    SELECT COUNT(*) as count FROM subscriptions
  `).get() as { count: number };

  const byTier: Record<SubscriptionTier, number> = {
    FREE: 0,
    ORGANIZED: 0,
    PROFESSIONAL: 0,
    CONCIERGE: 0,
  };

  const byStatus: Record<SubscriptionStatus, number> = {
    active: 0,
    trialing: 0,
    past_due: 0,
    canceled: 0,
    unpaid: 0,
    incomplete: 0,
    incomplete_expired: 0,
    paused: 0,
  };

  for (const { tier, count } of tierCounts) {
    byTier[tier] = count;
  }

  for (const { status, count } of statusCounts) {
    byStatus[status] = count;
  }

  return {
    totalUsers: totalUsers.count,
    byTier,
    byStatus,
  };
}
