// src/middleware/authorization.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Role } from '../types/roles.js';
import type { SubscriptionTier, TierFeature } from '../types/subscription.js';
import { hasRole, hasAnyRole, isAdmin, isSuperAdmin } from '../types/roles.js';
import { tierMeetsMinimum, tierHasFeature, getMinimumTierForFeature, TIER_CONFIGS } from '../config/tiers.js';

/**
 * Extended request type with user context
 */
export interface AuthenticatedRequest extends FastifyRequest {
  userId: string;
  userRoles: Role[];
  impersonatingUserId?: string;
}

/**
 * Create a preHandler that requires a specific role
 *
 * @param requiredRole - Minimum role required to access the route
 * @returns Fastify preHandler function
 */
export function requireRole(requiredRole: Role) {
  return async function(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const userId = (request as any).userId;
    const userRoles = (request as any).userRoles as Role[] | undefined;

    // Must be authenticated
    if (!userId) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Please log in to access this resource',
      });
    }

    // Must have roles attached
    if (!userRoles || userRoles.length === 0) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'No roles assigned',
      });
    }

    // Check role
    if (!hasRole(userRoles, requiredRole)) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: `Access denied. Required role: ${requiredRole}`,
      });
    }
  };
}

/**
 * Create a preHandler that requires any of the specified roles
 *
 * @param allowedRoles - Roles that grant access
 * @returns Fastify preHandler function
 */
export function requireAnyRole(allowedRoles: Role[]) {
  return async function(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const userId = (request as any).userId;
    const userRoles = (request as any).userRoles as Role[] | undefined;

    // Must be authenticated
    if (!userId) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Please log in to access this resource',
      });
    }

    // Must have roles attached
    if (!userRoles || userRoles.length === 0) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'No roles assigned',
      });
    }

    // Check roles
    if (!hasAnyRole(userRoles, allowedRoles)) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: `Access denied. Required roles: ${allowedRoles.join(' or ')}`,
      });
    }
  };
}

/**
 * PreHandler that requires ADMIN or SUPER_ADMIN role
 */
export const requireAdmin = requireAnyRole(['ADMIN', 'SUPER_ADMIN']);

/**
 * PreHandler that requires SUPER_ADMIN role
 */
export const requireSuperAdmin = requireRole('SUPER_ADMIN');

/**
 * Helper to get user roles from request
 *
 * @param request - Fastify request
 * @returns User roles or empty array
 */
export function getUserRolesFromRequest(request: FastifyRequest): Role[] {
  return (request as any).userRoles || [];
}

/**
 * Helper to check if request user is admin
 *
 * @param request - Fastify request
 * @returns true if user is admin
 */
export function isRequestUserAdmin(request: FastifyRequest): boolean {
  const roles = getUserRolesFromRequest(request);
  return isAdmin(roles);
}

/**
 * Helper to check if request user is super admin
 *
 * @param request - Fastify request
 * @returns true if user is super admin
 */
export function isRequestUserSuperAdmin(request: FastifyRequest): boolean {
  const roles = getUserRolesFromRequest(request);
  return isSuperAdmin(roles);
}

/**
 * Get impersonated user ID from request, or real user ID if not impersonating
 *
 * @param request - Fastify request
 * @returns User ID (impersonated if active, otherwise real)
 */
export function getEffectiveUserId(request: FastifyRequest): string {
  const impersonating = (request as any).impersonatingUserId;
  const userId = (request as any).userId;
  return impersonating || userId;
}

/**
 * Check if request is in impersonation mode
 *
 * @param request - Fastify request
 * @returns true if impersonating another user
 */
export function isImpersonating(request: FastifyRequest): boolean {
  return !!(request as any).impersonatingUserId;
}

/**
 * PreHandler that blocks the request if the admin is currently impersonating another user.
 * Use this on endpoints that fetch from external APIs (Gmail, Google Calendar) to prevent
 * cross-contamination: admin's OAuth tokens fetching data that gets stored under the
 * impersonated user's account.
 */
export async function requireNoImpersonation(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if ((request as any).impersonatingUserId) {
    return reply.code(403).send({
      error: 'Forbidden',
      message: 'This operation cannot be performed while impersonating another user. Stop impersonation first.',
    });
  }
}

// =====================================================
// SUBSCRIPTION TIER MIDDLEWARE
// =====================================================

/**
 * Extended request type with subscription context
 */
export interface SubscriptionRequest extends FastifyRequest {
  userId: string;
  userRoles: Role[];
  userTier: SubscriptionTier;
  subscriptionActive: boolean;
  impersonatingUserId?: string;
}

/**
 * Create a preHandler that requires a minimum subscription tier
 *
 * @param minTier - Minimum subscription tier required
 * @returns Fastify preHandler function
 */
export function requireTier(minTier: SubscriptionTier) {
  return async function(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const userId = (request as any).userId;
    const userTier = (request as any).userTier as SubscriptionTier | undefined;
    const subscriptionActive = (request as any).subscriptionActive as boolean | undefined;

    // Must be authenticated
    if (!userId) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Please log in to access this resource',
      });
    }

    // Default to FREE if no tier set
    const effectiveTier = userTier || 'FREE';

    // Check subscription is active
    if (subscriptionActive === false) {
      return reply.code(403).send({
        error: 'Subscription inactive',
        message: 'Your subscription is not active. Please update your payment method.',
        requiredTier: minTier,
      });
    }

    // Check tier level
    if (!tierMeetsMinimum(effectiveTier, minTier)) {
      const tierConfig = TIER_CONFIGS[minTier];
      return reply.code(403).send({
        error: 'Upgrade required',
        message: `This feature requires ${tierConfig.displayName} (${tierConfig.priceFormatted}/mo) or higher`,
        currentTier: effectiveTier,
        requiredTier: minTier,
        upgradeUrl: '/settings#subscription',
      });
    }
  };
}

/**
 * Create a preHandler that requires a specific feature
 *
 * @param feature - Feature that must be available
 * @returns Fastify preHandler function
 */
export function requireFeature(feature: TierFeature) {
  return async function(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const userId = (request as any).userId;
    const userTier = (request as any).userTier as SubscriptionTier | undefined;
    const subscriptionActive = (request as any).subscriptionActive as boolean | undefined;

    // Must be authenticated
    if (!userId) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Please log in to access this resource',
      });
    }

    // Default to FREE if no tier set
    const effectiveTier = userTier || 'FREE';

    // Check subscription is active
    if (subscriptionActive === false) {
      return reply.code(403).send({
        error: 'Subscription inactive',
        message: 'Your subscription is not active. Please update your payment method.',
        requiredFeature: feature,
      });
    }

    // Check feature access
    if (!tierHasFeature(effectiveTier, feature)) {
      const minTier = getMinimumTierForFeature(feature);
      const tierConfig = minTier ? TIER_CONFIGS[minTier] : null;

      return reply.code(403).send({
        error: 'Upgrade required',
        message: tierConfig
          ? `This feature requires ${tierConfig.displayName} (${tierConfig.priceFormatted}/mo) or higher`
          : 'This feature is not available on your plan',
        currentTier: effectiveTier,
        requiredFeature: feature,
        requiredTier: minTier,
        upgradeUrl: '/settings#subscription',
      });
    }
  };
}

/**
 * Convenience preHandler: requires ORGANIZED tier or higher
 */
export const requireOrganized = requireTier('ORGANIZED');

/**
 * Convenience preHandler: requires PROFESSIONAL tier or higher
 */
export const requireProfessional = requireTier('PROFESSIONAL');

/**
 * Convenience preHandler: requires CONCIERGE tier
 */
export const requireConcierge = requireTier('CONCIERGE');

/**
 * Helper to get user tier from request
 *
 * @param request - Fastify request
 * @returns User subscription tier (defaults to FREE)
 */
export function getUserTierFromRequest(request: FastifyRequest): SubscriptionTier {
  return (request as any).userTier || 'FREE';
}

/**
 * Helper to check if subscription is active from request
 *
 * @param request - Fastify request
 * @returns true if subscription is active
 */
export function isSubscriptionActiveFromRequest(request: FastifyRequest): boolean {
  const active = (request as any).subscriptionActive;
  return active !== false; // Default to true if not set
}

/**
 * Helper to check if user has access to a feature
 *
 * @param request - Fastify request
 * @param feature - Feature to check
 * @returns true if user has access to the feature
 */
export function hasFeatureAccess(request: FastifyRequest, feature: TierFeature): boolean {
  const tier = getUserTierFromRequest(request);
  const active = isSubscriptionActiveFromRequest(request);
  return active && tierHasFeature(tier, feature);
}
