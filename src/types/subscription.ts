// src/types/subscription.ts

/**
 * Subscription tiers for the pricing model
 *
 * Hierarchy (lowest to highest):
 * - FREE: Default for all users, no paid features
 * - ORGANIZED: "The Organized Parent" - £9/mo
 * - PROFESSIONAL: "The Professional" - £18/mo
 * - CONCIERGE: "The Concierge" - £38/mo
 */
export type SubscriptionTier = 'FREE' | 'ORGANIZED' | 'PROFESSIONAL' | 'CONCIERGE';

/**
 * Feature flags that can be gated by subscription tier
 */
export type TierFeature =
  // Organized tier (£9)
  | 'daily_brief'
  | 'attachment_analysis'
  | 'custom_training'
  // Professional tier (£18)
  | 'hosted_email'
  | 'calendar_sync'
  | 'ai_vision'
  | 'homework_integration'
  | 'action_links'
  | 'unlimited_senders'
  // Concierge tier (£38)
  | 'whatsapp_integration'
  | 'human_verification'
  | 'autopilot_tasks'
  | 'priority_support';

/**
 * Subscription status from Stripe
 */
export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

/**
 * Full subscription record for a user
 */
export interface UserSubscription {
  userId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tier limits configuration
 */
export interface TierLimits {
  maxTrackedSenders: number;
  maxFamilyPersonas: number;
  maxRecipients: number;
}

/**
 * Tier pricing and configuration
 */
export interface TierConfig {
  name: string;
  displayName: string;
  price: number; // in pence
  priceFormatted: string;
  features: TierFeature[];
  limits: TierLimits;
  stripePriceId: string;
}
