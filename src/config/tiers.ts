// src/config/tiers.ts

import type { SubscriptionTier, TierConfig, TierFeature } from '../types/subscription.js';

/**
 * Tier hierarchy for permission checking
 * Higher index = more permissions
 */
export const TIER_HIERARCHY: SubscriptionTier[] = ['FREE', 'ORGANIZED', 'PROFESSIONAL', 'CONCIERGE'];

/**
 * Stripe price IDs from environment
 */
const STRIPE_PRICES = {
  ORGANIZED: process.env.STRIPE_PRICE_ORGANIZED || '',
  PROFESSIONAL: process.env.STRIPE_PRICE_PROFESSIONAL || '',
  CONCIERGE: process.env.STRIPE_PRICE_CONCIERGE || '',
};

/**
 * Complete tier configuration
 */
export const TIER_CONFIGS: Record<SubscriptionTier, TierConfig> = {
  FREE: {
    name: 'FREE',
    displayName: 'Free',
    price: 0,
    priceFormatted: 'Free',
    features: [],
    limits: {
      maxTrackedSenders: 3,
      maxFamilyPersonas: 1,
      maxRecipients: 1,
    },
    stripePriceId: '',
  },
  ORGANIZED: {
    name: 'ORGANIZED',
    displayName: 'The Organized Parent',
    price: 900, // £9 in pence
    priceFormatted: '£9',
    features: [
      'daily_brief',
      'attachment_analysis',
      'custom_training',
    ],
    limits: {
      maxTrackedSenders: 20,
      maxFamilyPersonas: 1,
      maxRecipients: 2,
    },
    stripePriceId: STRIPE_PRICES.ORGANIZED,
  },
  PROFESSIONAL: {
    name: 'PROFESSIONAL',
    displayName: 'The Professional',
    price: 1800, // £18 in pence
    priceFormatted: '£18',
    features: [
      // Includes all ORGANIZED features
      'daily_brief',
      'attachment_analysis',
      'custom_training',
      // Plus Professional features
      'hosted_email',
      'calendar_sync',
      'ai_vision',
      'homework_integration',
      'action_links',
      'unlimited_senders',
    ],
    limits: {
      maxTrackedSenders: Infinity, // Unlimited
      maxFamilyPersonas: 4,
      maxRecipients: 4,
    },
    stripePriceId: STRIPE_PRICES.PROFESSIONAL,
  },
  CONCIERGE: {
    name: 'CONCIERGE',
    displayName: 'The Concierge',
    price: 3800, // £38 in pence
    priceFormatted: '£38',
    features: [
      // Includes all Professional features
      'daily_brief',
      'attachment_analysis',
      'custom_training',
      'hosted_email',
      'calendar_sync',
      'ai_vision',
      'homework_integration',
      'action_links',
      'unlimited_senders',
      // Plus Concierge features
      'whatsapp_integration',
      'human_verification',
      'autopilot_tasks',
      'priority_support',
    ],
    limits: {
      maxTrackedSenders: Infinity, // Unlimited
      maxFamilyPersonas: Infinity, // Unlimited
      maxRecipients: Infinity, // Unlimited
    },
    stripePriceId: STRIPE_PRICES.CONCIERGE,
  },
};

/**
 * Check if a tier has access to a specific feature
 *
 * @param tier - User's subscription tier
 * @param feature - Feature to check
 * @returns true if tier includes the feature
 */
export function tierHasFeature(tier: SubscriptionTier, feature: TierFeature): boolean {
  const config = TIER_CONFIGS[tier];
  return config.features.includes(feature);
}

/**
 * Get the tier level (index in hierarchy)
 * Higher number = higher tier
 *
 * @param tier - Subscription tier
 * @returns Tier level (0-3)
 */
export function getTierLevel(tier: SubscriptionTier): number {
  return TIER_HIERARCHY.indexOf(tier);
}

/**
 * Check if a tier meets the minimum required tier
 *
 * @param userTier - User's current tier
 * @param requiredTier - Minimum tier required
 * @returns true if user's tier meets or exceeds required tier
 */
export function tierMeetsMinimum(userTier: SubscriptionTier, requiredTier: SubscriptionTier): boolean {
  return getTierLevel(userTier) >= getTierLevel(requiredTier);
}

/**
 * Get the minimum tier required for a feature
 *
 * @param feature - Feature to check
 * @returns Minimum tier that includes this feature, or null if no tier has it
 */
export function getMinimumTierForFeature(feature: TierFeature): SubscriptionTier | null {
  for (const tier of TIER_HIERARCHY) {
    if (tierHasFeature(tier, feature)) {
      return tier;
    }
  }
  return null;
}

/**
 * Get tier configuration by tier name
 *
 * @param tier - Subscription tier
 * @returns Tier configuration
 */
export function getTierConfig(tier: SubscriptionTier): TierConfig {
  return TIER_CONFIGS[tier];
}

/**
 * Get all features available at a tier (including inherited from lower tiers)
 *
 * @param tier - Subscription tier
 * @returns Array of available features
 */
export function getTierFeatures(tier: SubscriptionTier): TierFeature[] {
  return TIER_CONFIGS[tier].features;
}

/**
 * Get tier limits for a subscription tier
 *
 * @param tier - Subscription tier
 * @returns Tier limits configuration
 */
export function getTierLimits(tier: SubscriptionTier): TierConfig['limits'] {
  return TIER_CONFIGS[tier].limits;
}

/**
 * Get the Stripe price ID for a tier
 *
 * @param tier - Subscription tier
 * @returns Stripe price ID or empty string if not configured
 */
export function getStripePriceId(tier: SubscriptionTier): string {
  return TIER_CONFIGS[tier].stripePriceId;
}

/**
 * Get tier by Stripe price ID
 *
 * @param priceId - Stripe price ID
 * @returns Subscription tier or null if not found
 */
export function getTierByPriceId(priceId: string): SubscriptionTier | null {
  for (const [tier, config] of Object.entries(TIER_CONFIGS)) {
    if (config.stripePriceId === priceId && priceId !== '') {
      return tier as SubscriptionTier;
    }
  }
  return null;
}
