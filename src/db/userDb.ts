// src/db/userDb.ts
import db from './db.js';
import type { UserProfile } from '../types/todo.js';
import type { Role } from '../types/roles.js';
import { DEFAULT_ROLES, SUPER_ADMIN_EMAIL } from '../types/roles.js';

/**
 * Prepared statements for user operations
 */

// UPSERT statement for storing user profile
// Uses INSERT OR REPLACE since user_id is primary key
const upsertStmt = db.prepare(`
  INSERT INTO users (user_id, email, name, picture_url, updated_at)
  VALUES (?, ?, ?, ?, datetime('now'))
  ON CONFLICT(user_id) DO UPDATE SET
    email = excluded.email,
    name = excluded.name,
    picture_url = excluded.picture_url,
    updated_at = datetime('now')
`);

// SELECT statement for retrieving user by ID
const getByIdStmt = db.prepare(`
  SELECT * FROM users WHERE user_id = ?
`);

// SELECT statement for retrieving user by email
const getByEmailStmt = db.prepare(`
  SELECT * FROM users WHERE email = ?
`);

// DELETE statement for removing a user
const deleteStmt = db.prepare(`
  DELETE FROM users WHERE user_id = ?
`);

// UPDATE statement for partial updates
const updateStmt = db.prepare(`
  UPDATE users
  SET email = ?, name = ?, picture_url = ?, updated_at = datetime('now')
  WHERE user_id = ?
`);

/**
 * Upsert user profile (insert or update)
 * Called after successful OAuth to store/update Google profile
 *
 * @param user - User profile from Google OAuth
 */
export function upsertUser(user: UserProfile): void {
  upsertStmt.run(
    user.user_id,
    user.email,
    user.name || null,
    user.picture_url || null
  );
}

/**
 * Get user profile by user ID
 *
 * @param userId - User ID
 * @returns User profile if found, null otherwise
 */
export function getUser(userId: string): UserProfile | null {
  const row = getByIdStmt.get(userId) as any;
  if (!row) return null;

  return rowToUserProfile(row);
}

/**
 * Get user profile by email address
 * Useful for login/lookup scenarios
 *
 * @param email - Email address
 * @returns User profile if found, null otherwise
 */
export function getUserByEmail(email: string): UserProfile | null {
  const row = getByEmailStmt.get(email) as any;
  if (!row) return null;

  return rowToUserProfile(row);
}

/**
 * Update user profile
 * Use for partial updates after upsert
 * Note: Passing undefined for a field will clear it (set to null)
 *
 * @param userId - User ID
 * @param updates - Partial user profile with fields to update
 * @returns true if updated, false if user not found
 */
export function updateUser(
  userId: string,
  updates: Partial<UserProfile>
): boolean {
  // Get existing user to merge updates
  const existing = getUser(userId);
  if (!existing) return false;

  // For each field, use the update value if provided, otherwise keep existing
  // Note: 'email' in updates checks if the key exists, not if the value is truthy
  const updatedUser: UserProfile = {
    user_id: userId,
    email: 'email' in updates ? updates.email! : existing.email,
    name: 'name' in updates ? updates.name : existing.name,
    picture_url: 'picture_url' in updates ? updates.picture_url : existing.picture_url,
  };

  updateStmt.run(
    updatedUser.email,
    updatedUser.name || null,
    updatedUser.picture_url || null,
    userId
  );

  return true;
}

/**
 * Delete user profile
 * Note: This will cascade delete sessions and auth due to foreign keys
 *
 * @param userId - User ID
 * @returns true if deleted, false if not found
 */
export function deleteUser(userId: string): boolean {
  const result = deleteStmt.run(userId);
  return result.changes > 0;
}

/**
 * Check if user exists
 *
 * @param userId - User ID
 * @returns true if user exists, false otherwise
 */
export function hasUser(userId: string): boolean {
  return getUser(userId) !== null;
}

/**
 * Helper function to convert database row to UserProfile
 *
 * @param row - Database row
 * @returns UserProfile object
 */
function rowToUserProfile(row: any): UserProfile {
  return {
    user_id: row.user_id,
    email: row.email,
    name: row.name || undefined,
    picture_url: row.picture_url || undefined,
    created_at: row.created_at ? new Date(row.created_at) : undefined,
    updated_at: row.updated_at ? new Date(row.updated_at) : undefined,
    onboarding_step: row.onboarding_step ?? 0,
    gmail_connected: !!row.gmail_connected,
    calendar_connected: !!row.calendar_connected,
  };
}

// ============================================
// ONBOARDING STATE FUNCTIONS
// ============================================

const updateOnboardingStepStmt = db.prepare(`
  UPDATE users SET onboarding_step = ?, updated_at = datetime('now') WHERE user_id = ?
`);

const updateGmailConnectedStmt = db.prepare(`
  UPDATE users SET gmail_connected = ?, updated_at = datetime('now') WHERE user_id = ?
`);

/**
 * Update a user's onboarding step
 */
export function updateOnboardingStep(userId: string, step: number): void {
  updateOnboardingStepStmt.run(step, userId);
}

/**
 * Mark a user's Gmail as connected
 */
export function setGmailConnected(userId: string, connected: boolean): void {
  updateGmailConnectedStmt.run(connected ? 1 : 0, userId);
}

// Calendar connection state
const updateCalendarConnectedStmt = db.prepare(`
  UPDATE users SET calendar_connected = ?, updated_at = datetime('now') WHERE user_id = ?
`);

const isCalendarConnectedStmt = db.prepare(`
  SELECT calendar_connected FROM users WHERE user_id = ?
`);

/**
 * Mark a user's Google Calendar as connected
 */
export function setCalendarConnected(userId: string, connected: boolean): void {
  updateCalendarConnectedStmt.run(connected ? 1 : 0, userId);
}

/**
 * Check if a user has connected Google Calendar
 */
export function isCalendarConnected(userId: string): boolean {
  const row = isCalendarConnectedStmt.get(userId) as { calendar_connected: number } | undefined;
  return !!row?.calendar_connected;
}

// ============================================
// ROLE-BASED ACCESS CONTROL (RBAC) FUNCTIONS
// ============================================

// Prepared statement for getting user roles
const getRolesStmt = db.prepare(`
  SELECT roles FROM users WHERE user_id = ?
`);

// Prepared statement for updating user roles
const updateRolesStmt = db.prepare(`
  UPDATE users SET roles = ?, updated_at = datetime('now') WHERE user_id = ?
`);

// Prepared statement for getting all users (for admin dropdown)
const getAllUsersStmt = db.prepare(`
  SELECT user_id, email, name, picture_url, roles, created_at, updated_at
  FROM users
  ORDER BY email
`);

/**
 * User profile with roles
 */
export interface UserWithRoles extends UserProfile {
  roles: Role[];
}

/**
 * Get user roles by user ID
 *
 * @param userId - User ID
 * @returns Array of roles, or DEFAULT_ROLES if user not found
 */
export function getUserRoles(userId: string): Role[] {
  const row = getRolesStmt.get(userId) as { roles: string } | undefined;
  if (!row) return DEFAULT_ROLES;

  try {
    const roles = JSON.parse(row.roles) as Role[];
    return roles.length > 0 ? roles : DEFAULT_ROLES;
  } catch {
    return DEFAULT_ROLES;
  }
}

/**
 * Get user roles by email address
 * Used during login to assign appropriate roles
 *
 * @param email - User email
 * @returns Array of roles
 */
export function getUserRolesByEmail(email: string): Role[] {
  // Super admin gets all roles
  if (email === SUPER_ADMIN_EMAIL) {
    return ['STANDARD', 'ADMIN', 'SUPER_ADMIN'];
  }

  const user = getUserByEmail(email);
  if (!user) return DEFAULT_ROLES;

  return getUserRoles(user.user_id);
}

/**
 * Update user roles
 *
 * @param userId - User ID
 * @param roles - New array of roles
 * @returns true if updated, false if user not found
 */
export function updateUserRoles(userId: string, roles: Role[]): boolean {
  // Ensure at least STANDARD role
  const finalRoles = roles.length > 0 ? roles : DEFAULT_ROLES;
  const result = updateRolesStmt.run(JSON.stringify(finalRoles), userId);
  return result.changes > 0;
}

/**
 * Get user with roles by user ID
 *
 * @param userId - User ID
 * @returns User profile with roles, or null if not found
 */
export function getUserWithRoles(userId: string): UserWithRoles | null {
  const user = getUser(userId);
  if (!user) return null;

  const roles = getUserRoles(userId);
  return { ...user, roles };
}

/**
 * Get all users with roles (for admin user list)
 *
 * @returns Array of all users with their roles
 */
export function getAllUsersWithRoles(): UserWithRoles[] {
  const rows = getAllUsersStmt.all() as any[];

  return rows.map(row => {
    let roles: Role[] = DEFAULT_ROLES;
    try {
      roles = JSON.parse(row.roles || '["STANDARD"]') as Role[];
    } catch {
      roles = DEFAULT_ROLES;
    }

    return {
      user_id: row.user_id,
      email: row.email,
      name: row.name || undefined,
      picture_url: row.picture_url || undefined,
      created_at: row.created_at ? new Date(row.created_at) : undefined,
      updated_at: row.updated_at ? new Date(row.updated_at) : undefined,
      roles,
    };
  });
}

/**
 * Ensure super admin has all roles (called during login)
 * This handles the case where the super admin already exists but doesn't have all roles
 *
 * @param email - User email to check
 */
export function ensureSuperAdminRoles(email: string): void {
  if (email !== SUPER_ADMIN_EMAIL) return;

  const user = getUserByEmail(email);
  if (!user) return;

  const currentRoles = getUserRoles(user.user_id);
  const hasAllRoles =
    currentRoles.includes('STANDARD') &&
    currentRoles.includes('ADMIN') &&
    currentRoles.includes('SUPER_ADMIN');

  if (!hasAllRoles) {
    updateUserRoles(user.user_id, ['STANDARD', 'ADMIN', 'SUPER_ADMIN']);
  }
}

// ============================================
// ONBOARDING PATH FUNCTIONS
// ============================================

const setOnboardingPathStmt = db.prepare(`
  UPDATE users SET onboarding_path = ?, updated_at = datetime('now') WHERE user_id = ?
`);

const getOnboardingPathStmt = db.prepare(`
  SELECT onboarding_path FROM users WHERE user_id = ?
`);

/**
 * Set the onboarding path for a user
 */
export function setOnboardingPath(userId: string, path: 'hosted' | 'gmail'): void {
  setOnboardingPathStmt.run(path, userId);
}

/**
 * Get the onboarding path for a user
 */
export function getOnboardingPath(userId: string): 'hosted' | 'gmail' | null {
  const row = getOnboardingPathStmt.get(userId) as { onboarding_path: string | null } | undefined;
  const val = row?.onboarding_path;
  if (val === 'hosted' || val === 'gmail') return val;
  return null;
}

// ============================================
// HOSTED EMAIL ALIAS FUNCTIONS
// ============================================

const HOSTED_EMAIL_DOMAIN = 'inbox.getfamilyassistant.com';

// Prepared statements for hosted email
const getByAliasStmt = db.prepare(`
  SELECT * FROM users WHERE LOWER(hosted_email_alias) = LOWER(?)
`);

const checkAliasStmt = db.prepare(`
  SELECT 1 FROM users WHERE LOWER(hosted_email_alias) = LOWER(?)
`);

const setAliasStmt = db.prepare(`
  UPDATE users
  SET hosted_email_alias = LOWER(?), updated_at = datetime('now')
  WHERE user_id = ?
`);

const clearAliasStmt = db.prepare(`
  UPDATE users
  SET hosted_email_alias = NULL, updated_at = datetime('now')
  WHERE user_id = ?
`);

const getAliasStmt = db.prepare(`
  SELECT hosted_email_alias FROM users WHERE user_id = ?
`);

/**
 * Get user by hosted email alias
 * Used when receiving inbound emails to look up the user
 *
 * @param alias - The alias part (e.g., "toby" from "toby@inbox.getfamilyassistant.com")
 * @returns User profile or null
 */
export function getUserByHostedAlias(alias: string): UserProfile | null {
  const row = getByAliasStmt.get(alias.toLowerCase()) as any;
  if (!row) return null;
  return rowToUserProfile(row);
}

/**
 * Check if a hosted email alias is available
 *
 * @param alias - The alias to check
 * @returns true if available, false if taken
 */
export function isHostedAliasAvailable(alias: string): boolean {
  const row = checkAliasStmt.get(alias.toLowerCase());
  return !row;
}

/**
 * Validate hosted email alias format
 *
 * @param alias - The alias to validate
 * @returns Object with valid boolean and optional error message
 */
export function validateHostedAlias(alias: string): { valid: boolean; error?: string } {
  if (!alias) {
    return { valid: false, error: 'Alias is required' };
  }

  if (alias.length < 2) {
    return { valid: false, error: 'Alias must be at least 2 characters' };
  }

  if (alias.length > 30) {
    return { valid: false, error: 'Alias must be 30 characters or less' };
  }

  // Allow: letters, numbers, dots, hyphens, underscores
  // Must start and end with letter or number
  if (!/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/i.test(alias) && alias.length > 1) {
    return { valid: false, error: 'Alias can only contain letters, numbers, dots, hyphens, and underscores' };
  }

  // Single character aliases must be alphanumeric
  if (alias.length === 2 && !/^[a-z0-9]{2}$/i.test(alias)) {
    return { valid: false, error: 'Short aliases must be alphanumeric' };
  }

  // Reserved aliases
  const reserved = ['admin', 'support', 'help', 'info', 'contact', 'mail', 'email', 'noreply', 'no-reply', 'postmaster', 'webmaster', 'abuse'];
  if (reserved.includes(alias.toLowerCase())) {
    return { valid: false, error: 'This alias is reserved' };
  }

  return { valid: true };
}

/**
 * Set hosted email alias for a user
 * Will fail if alias is already taken (unique constraint)
 *
 * @param userId - User ID
 * @param alias - The alias to claim (will be lowercased)
 * @returns true if successful, false if alias taken
 */
export function setHostedEmailAlias(userId: string, alias: string): boolean {
  try {
    const result = setAliasStmt.run(alias.toLowerCase(), userId);
    return result.changes > 0;
  } catch (error: any) {
    // Unique constraint violation
    if (error.code === 'SQLITE_CONSTRAINT' || error.message?.includes('UNIQUE')) {
      return false;
    }
    throw error;
  }
}

/**
 * Clear hosted email alias for a user
 * Used when switching back to Gmail mode
 *
 * @param userId - User ID
 */
export function clearHostedEmailAlias(userId: string): void {
  clearAliasStmt.run(userId);
}

/**
 * Get user's hosted email alias
 *
 * @param userId - User ID
 * @returns Alias or null
 */
export function getHostedEmailAlias(userId: string): string | null {
  const row = getAliasStmt.get(userId) as { hosted_email_alias: string | null } | undefined;
  return row?.hosted_email_alias || null;
}

/**
 * Get user's full hosted email address
 *
 * @param userId - User ID
 * @returns Full email address or null if no alias set
 */
export function getHostedEmailAddress(userId: string): string | null {
  const alias = getHostedEmailAlias(userId);
  if (!alias) return null;
  return `${alias}@${HOSTED_EMAIL_DOMAIN}`;
}

/**
 * Get the hosted email domain
 */
export function getHostedEmailDomain(): string {
  return HOSTED_EMAIL_DOMAIN;
}

// ============================================
// GMAIL FORWARDING CONFIRMATION
// ============================================

/**
 * Store the Gmail forwarding confirmation URL for a user
 */
export function setGmailConfirmationUrl(userId: string, url: string): void {
  db.prepare(`UPDATE users SET gmail_forwarding_confirmation_url = ? WHERE user_id = ?`).run(url, userId);
}

/**
 * Get the Gmail forwarding confirmation URL for a user, if received
 */
export function getGmailConfirmationUrl(userId: string): string | null {
  const row = db.prepare(`SELECT gmail_forwarding_confirmation_url FROM users WHERE user_id = ?`).get(userId) as { gmail_forwarding_confirmation_url: string | null } | undefined;
  return row?.gmail_forwarding_confirmation_url ?? null;
}

// ============================================
// USER RESET (SUPER_ADMIN ONLY)
// ============================================

/**
 * Reset a user's account to initial state.
 * Deletes all user data but preserves the users row and active sessions.
 * Resets onboarding_step to 0 and gmail_connected to 0.
 *
 * @param userId - User ID to reset
 * @returns Summary of deleted records per table
 */
export function resetUserData(userId: string): Record<string, number> {
  const summary: Record<string, number> = {};

  const deletions = db.transaction(() => {
    // Order matters: delete child tables before parent tables

    // Delete email_attachments (via emails join)
    const attachmentResult = db.prepare(`
      DELETE FROM email_attachments WHERE email_id IN (
        SELECT id FROM emails WHERE user_id = ?
      )
    `).run(userId);
    summary['email_attachments'] = attachmentResult.changes;

    // Tables with direct user_id foreign key
    const tables = [
      'email_analyses',
      'emails',
      'todos',
      'events',
      'email_summaries',
      'child_profiles',
      'recurring_activities',
      'processed_emails',
      'email_action_tokens',
      'sender_filters',
      'user_settings',
      'ai_metrics',
      'auth',
    ];

    for (const table of tables) {
      try {
        const result = db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
        summary[table] = result.changes;
      } catch {
        // Table may not exist
        summary[table] = 0;
      }
    }

    // Reset onboarding state on users row
    const resetResult = db.prepare(`
      UPDATE users
      SET onboarding_step = 0, gmail_connected = 0, hosted_email_alias = NULL, onboarding_path = NULL, updated_at = datetime('now')
      WHERE user_id = ?
    `).run(userId);
    console.log(`[resetUserData] Reset onboarding state for ${userId}, rows affected: ${resetResult.changes}`);

    return summary;
  });

  return deletions();
}
