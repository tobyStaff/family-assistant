// src/middleware/authorization.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Role } from '../types/roles.js';
import { hasRole, hasAnyRole, isAdmin, isSuperAdmin } from '../types/roles.js';

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
