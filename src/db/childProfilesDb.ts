// src/db/childProfilesDb.ts

import db from './db.js';
import type { ChildProfile } from '../types/childProfile.js';

/**
 * Internal database record
 */
interface ChildProfileRow {
  id: number;
  user_id: string;
  real_name: string;
  display_name: string | null;
  year_group: string | null;
  school_name: string | null;
  is_active: number;
  onboarding_completed: number;
  confidence_score: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Convert database row to TypeScript interface
 */
function rowToProfile(row: ChildProfileRow): ChildProfile {
  return {
    id: row.id,
    user_id: row.user_id,
    real_name: row.real_name,
    display_name: row.display_name || undefined,
    year_group: row.year_group || undefined,
    school_name: row.school_name || undefined,
    is_active: Boolean(row.is_active),
    onboarding_completed: Boolean(row.onboarding_completed),
    confidence_score: row.confidence_score || undefined,
    notes: row.notes || undefined,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

/**
 * Create a new child profile
 * Returns the new profile ID
 */
export function createChildProfile(profile: ChildProfile): number {
  const stmt = db.prepare(`
    INSERT INTO child_profiles (
      user_id, real_name, display_name, year_group, school_name,
      is_active, onboarding_completed, confidence_score, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    profile.user_id,
    profile.real_name,
    profile.display_name || null,
    profile.year_group || null,
    profile.school_name || null,
    profile.is_active ? 1 : 0,
    profile.onboarding_completed ? 1 : 0,
    profile.confidence_score || null,
    profile.notes || null
  );

  return result.lastInsertRowid as number;
}

/**
 * Get all child profiles for a user
 * @param userId User ID
 * @param activeOnly If true, only return active profiles
 */
export function getChildProfiles(
  userId: string,
  activeOnly: boolean = false
): ChildProfile[] {
  const query = activeOnly
    ? `SELECT * FROM child_profiles WHERE user_id = ? AND is_active = 1 ORDER BY real_name ASC`
    : `SELECT * FROM child_profiles WHERE user_id = ? ORDER BY is_active DESC, real_name ASC`;

  const stmt = db.prepare(query);
  const rows = stmt.all(userId) as ChildProfileRow[];
  return rows.map(rowToProfile);
}

/**
 * Get a single child profile by ID
 */
export function getChildProfile(
  userId: string,
  profileId: number
): ChildProfile | null {
  const stmt = db.prepare(`
    SELECT * FROM child_profiles
    WHERE id = ? AND user_id = ?
  `);

  const row = stmt.get(profileId, userId) as ChildProfileRow | undefined;
  return row ? rowToProfile(row) : null;
}

/**
 * Update a child profile
 * Returns true if successful, false if not found
 */
export function updateChildProfile(
  userId: string,
  profileId: number,
  updates: Partial<ChildProfile>
): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.real_name !== undefined) {
    fields.push('real_name = ?');
    values.push(updates.real_name);
  }
  if (updates.display_name !== undefined) {
    fields.push('display_name = ?');
    values.push(updates.display_name || null);
  }
  if (updates.year_group !== undefined) {
    fields.push('year_group = ?');
    values.push(updates.year_group || null);
  }
  if (updates.school_name !== undefined) {
    fields.push('school_name = ?');
    values.push(updates.school_name || null);
  }
  if (updates.is_active !== undefined) {
    fields.push('is_active = ?');
    values.push(updates.is_active ? 1 : 0);
  }
  if (updates.onboarding_completed !== undefined) {
    fields.push('onboarding_completed = ?');
    values.push(updates.onboarding_completed ? 1 : 0);
  }
  if (updates.confidence_score !== undefined) {
    fields.push('confidence_score = ?');
    values.push(updates.confidence_score);
  }
  if (updates.notes !== undefined) {
    fields.push('notes = ?');
    values.push(updates.notes || null);
  }

  if (fields.length === 0) {
    return false; // Nothing to update
  }

  // Always update updated_at timestamp
  fields.push('updated_at = CURRENT_TIMESTAMP');

  const stmt = db.prepare(`
    UPDATE child_profiles
    SET ${fields.join(', ')}
    WHERE id = ? AND user_id = ?
  `);

  const result = stmt.run(...values, profileId, userId);
  return result.changes > 0;
}

/**
 * Delete a child profile
 * Returns true if successful, false if not found
 */
export function deleteChildProfile(
  userId: string,
  profileId: number
): boolean {
  const stmt = db.prepare(`
    DELETE FROM child_profiles
    WHERE id = ? AND user_id = ?
  `);

  const result = stmt.run(profileId, userId);
  return result.changes > 0;
}

/**
 * Mark all profiles as onboarding completed for a user
 */
export function completeOnboarding(userId: string): number {
  const stmt = db.prepare(`
    UPDATE child_profiles
    SET onboarding_completed = 1, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND onboarding_completed = 0
  `);

  const result = stmt.run(userId);
  return result.changes;
}

/**
 * Check if user has completed onboarding
 */
export function hasCompletedOnboarding(userId: string): boolean {
  const stmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM child_profiles
    WHERE user_id = ? AND onboarding_completed = 1
  `);

  const row = stmt.get(userId) as { count: number };
  return row.count > 0;
}

/**
 * Get all unique school names for a user
 */
export function getUserSchools(userId: string): string[] {
  const stmt = db.prepare(`
    SELECT DISTINCT school_name
    FROM child_profiles
    WHERE user_id = ? AND school_name IS NOT NULL AND is_active = 1
    ORDER BY school_name ASC
  `);

  const rows = stmt.all(userId) as { school_name: string }[];
  return rows.map(row => row.school_name);
}

/**
 * Batch create child profiles from onboarding
 * Returns array of created IDs
 */
export function createChildProfilesBatch(profiles: ChildProfile[]): number[] {
  const ids: number[] = [];

  const transaction = db.transaction((profiles: ChildProfile[]) => {
    for (const profile of profiles) {
      const id = createChildProfile(profile);
      ids.push(id);
    }
  });

  transaction(profiles);
  return ids;
}
