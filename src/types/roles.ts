// src/types/roles.ts

/**
 * User roles for role-based access control (RBAC)
 *
 * Hierarchy:
 * - STANDARD: Default role for all users (basic access)
 * - ADMIN: Access to admin tools and dashboard
 * - SUPER_ADMIN: Full access including user impersonation
 */
export type Role = 'STANDARD' | 'ADMIN' | 'SUPER_ADMIN';

/**
 * Role hierarchy for permission checking
 * Higher index = more permissions
 */
export const ROLE_HIERARCHY: Role[] = ['STANDARD', 'ADMIN', 'SUPER_ADMIN'];

/**
 * Check if a user has at least the required role level
 *
 * @param userRoles - Array of roles the user has
 * @param requiredRole - Minimum role required
 * @returns true if user has required role or higher
 */
export function hasRole(userRoles: Role[], requiredRole: Role): boolean {
  const requiredIndex = ROLE_HIERARCHY.indexOf(requiredRole);
  return userRoles.some(role => ROLE_HIERARCHY.indexOf(role) >= requiredIndex);
}

/**
 * Check if user has any of the specified roles
 *
 * @param userRoles - Array of roles the user has
 * @param allowedRoles - Roles that grant access
 * @returns true if user has any of the allowed roles
 */
export function hasAnyRole(userRoles: Role[], allowedRoles: Role[]): boolean {
  return userRoles.some(role => allowedRoles.includes(role));
}

/**
 * Check if user is a super admin
 *
 * @param userRoles - Array of roles the user has
 * @returns true if user has SUPER_ADMIN role
 */
export function isSuperAdmin(userRoles: Role[]): boolean {
  return userRoles.includes('SUPER_ADMIN');
}

/**
 * Check if user is an admin (ADMIN or SUPER_ADMIN)
 *
 * @param userRoles - Array of roles the user has
 * @returns true if user has ADMIN or SUPER_ADMIN role
 */
export function isAdmin(userRoles: Role[]): boolean {
  return userRoles.includes('ADMIN') || userRoles.includes('SUPER_ADMIN');
}

/**
 * Default roles for new users
 */
export const DEFAULT_ROLES: Role[] = ['STANDARD'];

/**
 * Super admin email - grants all roles
 */
export const SUPER_ADMIN_EMAIL = 'tobystafford.assistant@gmail.com';
