// src/utils/tierLimits.ts

import type { FastifyRequest } from 'fastify';
import type { SubscriptionTier, TierFeature } from '../types/subscription.js';
import { getUserTier, isSubscriptionActive } from '../db/subscriptionDb.js';
import { getTierLimits, tierHasFeature, getMinimumTierForFeature, TIER_CONFIGS } from '../config/tiers.js';
import { getSenderFilters } from '../db/senderFilterDb.js';
import { getChildProfiles } from '../db/childProfilesDb.js';
import { getSettings } from '../db/settingsDb.js';

/**
 * Result of a limit check
 */
export interface LimitCheckResult {
  allowed: boolean;
  current: number;
  limit: number;
  message?: string;
  upgradeUrl?: string;
  requiredTier?: SubscriptionTier;
}

/**
 * Result of a feature check
 */
export interface FeatureCheckResult {
  available: boolean;
  currentTier: SubscriptionTier;
  requiredTier: SubscriptionTier | null;
  message?: string;
  upgradeUrl?: string;
}

/**
 * Check if user can add another tracked sender
 *
 * @param userId - User ID
 * @returns Limit check result
 */
export function checkSenderLimit(userId: string): LimitCheckResult {
  const tier = getUserTier(userId);
  const limits = getTierLimits(tier);
  const senders = getSenderFilters(userId);
  const includedSenders = senders.filter(s => s.status === 'include');
  const current = includedSenders.length;

  if (limits.maxTrackedSenders === Infinity || current < limits.maxTrackedSenders) {
    return {
      allowed: true,
      current,
      limit: limits.maxTrackedSenders,
    };
  }

  // Find next tier with higher limit
  const nextTier = findNextTierForLimit('maxTrackedSenders', limits.maxTrackedSenders);

  return {
    allowed: false,
    current,
    limit: limits.maxTrackedSenders,
    message: `You've reached the maximum of ${limits.maxTrackedSenders} tracked senders for your plan`,
    upgradeUrl: '/settings#subscription',
    requiredTier: nextTier,
  };
}

/**
 * Check if user can add another family persona (child profile)
 *
 * @param userId - User ID
 * @returns Limit check result
 */
export function checkFamilyPersonasLimit(userId: string): LimitCheckResult {
  const tier = getUserTier(userId);
  const limits = getTierLimits(tier);
  const profiles = getChildProfiles(userId);
  const activeProfiles = profiles.filter(p => p.is_active);
  const current = activeProfiles.length;

  if (limits.maxFamilyPersonas === Infinity || current < limits.maxFamilyPersonas) {
    return {
      allowed: true,
      current,
      limit: limits.maxFamilyPersonas,
    };
  }

  // Find next tier with higher limit
  const nextTier = findNextTierForLimit('maxFamilyPersonas', limits.maxFamilyPersonas);

  return {
    allowed: false,
    current,
    limit: limits.maxFamilyPersonas,
    message: `You've reached the maximum of ${limits.maxFamilyPersonas} child profiles for your plan`,
    upgradeUrl: '/settings#subscription',
    requiredTier: nextTier,
  };
}

/**
 * Check if user can add a recipient (summary email recipients)
 *
 * @param userId - User ID
 * @param additionalCount - Number of recipients being added (default 1)
 * @returns Limit check result
 */
export function checkRecipientLimit(userId: string, additionalCount: number = 1): LimitCheckResult {
  const tier = getUserTier(userId);
  const limits = getTierLimits(tier);
  const settings = getSettings(userId);
  const recipients = settings?.summary_email_recipients || [];
  const current = recipients.length;
  const newTotal = current + additionalCount;

  if (limits.maxRecipients === Infinity || newTotal <= limits.maxRecipients) {
    return {
      allowed: true,
      current,
      limit: limits.maxRecipients,
    };
  }

  // Find next tier with higher limit
  const nextTier = findNextTierForLimit('maxRecipients', limits.maxRecipients);

  return {
    allowed: false,
    current,
    limit: limits.maxRecipients,
    message: `You can only have ${limits.maxRecipients} summary recipients on your plan`,
    upgradeUrl: '/settings#subscription',
    requiredTier: nextTier,
  };
}

/**
 * Check if user has access to a feature
 *
 * @param userId - User ID
 * @param feature - Feature to check
 * @returns Feature check result
 */
export function getFeatureAvailability(userId: string, feature: TierFeature): FeatureCheckResult {
  const tier = getUserTier(userId);
  const active = isSubscriptionActive(userId);

  if (!active) {
    return {
      available: false,
      currentTier: tier,
      requiredTier: null,
      message: 'Your subscription is not active. Please update your payment method.',
      upgradeUrl: '/settings#subscription',
    };
  }

  if (tierHasFeature(tier, feature)) {
    return {
      available: true,
      currentTier: tier,
      requiredTier: null,
    };
  }

  const requiredTier = getMinimumTierForFeature(feature);
  const tierConfig = requiredTier ? TIER_CONFIGS[requiredTier] : null;

  return {
    available: false,
    currentTier: tier,
    requiredTier,
    message: tierConfig
      ? `This feature requires ${tierConfig.displayName} (${tierConfig.priceFormatted}/mo)`
      : 'This feature is not available',
    upgradeUrl: '/settings#subscription',
  };
}

/**
 * Get all feature availability for a user (for UI display)
 *
 * @param userId - User ID
 * @returns Map of feature to availability
 */
export function getAllFeatureAvailability(userId: string): Record<TierFeature, FeatureCheckResult> {
  const features: TierFeature[] = [
    'daily_brief',
    'attachment_analysis',
    'custom_training',
    'hosted_email',
    'calendar_sync',
    'ai_vision',
    'homework_integration',
    'action_links',
    'unlimited_senders',
    'whatsapp_integration',
    'human_verification',
    'autopilot_tasks',
    'priority_support',
  ];

  const result: Record<string, FeatureCheckResult> = {};
  for (const feature of features) {
    result[feature] = getFeatureAvailability(userId, feature);
  }

  return result as Record<TierFeature, FeatureCheckResult>;
}

/**
 * Get remaining capacity for each limit
 *
 * @param userId - User ID
 * @returns Current usage and limits
 */
export function getLimitUsage(userId: string): {
  senders: LimitCheckResult;
  personas: LimitCheckResult;
  recipients: LimitCheckResult;
} {
  return {
    senders: checkSenderLimit(userId),
    personas: checkFamilyPersonasLimit(userId),
    recipients: checkRecipientLimit(userId, 0),
  };
}

/**
 * Find the next tier that has a higher limit for a given limit type
 *
 * @param limitType - Type of limit to check
 * @param currentLimit - Current limit value
 * @returns Next tier with higher limit, or null
 */
function findNextTierForLimit(
  limitType: 'maxTrackedSenders' | 'maxFamilyPersonas' | 'maxRecipients',
  currentLimit: number
): SubscriptionTier | null {
  const tiers: SubscriptionTier[] = ['FREE', 'ORGANIZED', 'PROFESSIONAL', 'CONCIERGE'];

  for (const tier of tiers) {
    const limits = getTierLimits(tier);
    const tierLimit = limits[limitType];
    if (tierLimit === Infinity || tierLimit > currentLimit) {
      return tier;
    }
  }

  return null;
}

/**
 * Check sender limit from request context
 *
 * @param request - Fastify request
 * @returns Limit check result
 */
export function checkSenderLimitFromRequest(request: FastifyRequest): LimitCheckResult {
  const userId = (request as any).impersonatingUserId || (request as any).userId;
  if (!userId) {
    return {
      allowed: false,
      current: 0,
      limit: 0,
      message: 'Not authenticated',
    };
  }
  return checkSenderLimit(userId);
}

/**
 * Check family personas limit from request context
 *
 * @param request - Fastify request
 * @returns Limit check result
 */
export function checkFamilyPersonasLimitFromRequest(request: FastifyRequest): LimitCheckResult {
  const userId = (request as any).impersonatingUserId || (request as any).userId;
  if (!userId) {
    return {
      allowed: false,
      current: 0,
      limit: 0,
      message: 'Not authenticated',
    };
  }
  return checkFamilyPersonasLimit(userId);
}

/**
 * Check recipient limit from request context
 *
 * @param request - Fastify request
 * @param additionalCount - Number of recipients being added
 * @returns Limit check result
 */
export function checkRecipientLimitFromRequest(
  request: FastifyRequest,
  additionalCount: number = 1
): LimitCheckResult {
  const userId = (request as any).impersonatingUserId || (request as any).userId;
  if (!userId) {
    return {
      allowed: false,
      current: 0,
      limit: 0,
      message: 'Not authenticated',
    };
  }
  return checkRecipientLimit(userId, additionalCount);
}
