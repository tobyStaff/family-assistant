// src/db/recurringActivitiesDb.ts

import db from './db.js';

/**
 * Recurring activity record (TypeScript interface)
 */
export interface RecurringActivity {
  id?: number;
  user_id: string;
  description: string;
  child: string;
  days_of_week: number[]; // [1, 2] = Monday, Tuesday (1=Mon, 7=Sun)
  frequency: string; // "weekly" for now
  requires_kit: boolean;
  kit_items: string[]; // Empty array if no items
  created_at?: Date;
  updated_at?: Date;
}

/**
 * Internal database record (JSON fields stored as strings)
 */
interface RecurringActivityRow {
  id: number;
  user_id: string;
  description: string;
  child: string;
  days_of_week: string; // JSON string
  frequency: string;
  requires_kit: number; // SQLite stores BOOLEAN as 0/1
  kit_items: string; // JSON string (always an array, can be empty [])
  created_at: string;
  updated_at: string;
}

/**
 * Convert database row to TypeScript interface
 */
function rowToActivity(row: RecurringActivityRow): RecurringActivity {
  return {
    id: row.id,
    user_id: row.user_id,
    description: row.description,
    child: row.child,
    days_of_week: JSON.parse(row.days_of_week),
    frequency: row.frequency,
    requires_kit: Boolean(row.requires_kit),
    kit_items: JSON.parse(row.kit_items), // Always a JSON array (can be empty [])
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

/**
 * Create a new recurring activity
 * Returns the new activity ID
 */
export function createRecurringActivity(activity: RecurringActivity): number {
  const stmt = db.prepare(`
    INSERT INTO recurring_activities (
      user_id, description, child, days_of_week, frequency, requires_kit, kit_items
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    activity.user_id,
    activity.description,
    activity.child,
    JSON.stringify(activity.days_of_week),
    activity.frequency,
    activity.requires_kit ? 1 : 0,
    JSON.stringify(activity.kit_items) // Always store as JSON array (can be empty [])
  );

  return result.lastInsertRowid as number;
}

/**
 * Get all recurring activities for a user
 */
export function getRecurringActivities(userId: string): RecurringActivity[] {
  const stmt = db.prepare(`
    SELECT * FROM recurring_activities
    WHERE user_id = ?
    ORDER BY child ASC, description ASC
  `);

  const rows = stmt.all(userId) as RecurringActivityRow[];
  return rows.map(rowToActivity);
}

/**
 * Get recurring activities for a specific child
 */
export function getRecurringActivitiesByChild(
  userId: string,
  child: string
): RecurringActivity[] {
  const stmt = db.prepare(`
    SELECT * FROM recurring_activities
    WHERE user_id = ? AND child = ?
    ORDER BY description ASC
  `);

  const rows = stmt.all(userId, child) as RecurringActivityRow[];
  return rows.map(rowToActivity);
}

/**
 * Get a single recurring activity by ID
 */
export function getRecurringActivity(
  userId: string,
  activityId: number
): RecurringActivity | null {
  const stmt = db.prepare(`
    SELECT * FROM recurring_activities
    WHERE id = ? AND user_id = ?
  `);

  const row = stmt.get(activityId, userId) as RecurringActivityRow | undefined;
  return row ? rowToActivity(row) : null;
}

/**
 * Update a recurring activity
 * Returns true if successful, false if not found
 */
export function updateRecurringActivity(
  userId: string,
  activityId: number,
  updates: Partial<RecurringActivity>
): boolean {
  // Build dynamic UPDATE query based on provided fields
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.description !== undefined) {
    fields.push('description = ?');
    values.push(updates.description);
  }
  if (updates.child !== undefined) {
    fields.push('child = ?');
    values.push(updates.child);
  }
  if (updates.days_of_week !== undefined) {
    fields.push('days_of_week = ?');
    values.push(JSON.stringify(updates.days_of_week));
  }
  if (updates.frequency !== undefined) {
    fields.push('frequency = ?');
    values.push(updates.frequency);
  }
  if (updates.requires_kit !== undefined) {
    fields.push('requires_kit = ?');
    values.push(updates.requires_kit ? 1 : 0);
  }
  if (updates.kit_items !== undefined) {
    fields.push('kit_items = ?');
    values.push(JSON.stringify(updates.kit_items)); // Always stringify (can be empty [])
  }

  if (fields.length === 0) {
    return false; // Nothing to update
  }

  // Always update updated_at timestamp
  fields.push('updated_at = CURRENT_TIMESTAMP');

  const stmt = db.prepare(`
    UPDATE recurring_activities
    SET ${fields.join(', ')}
    WHERE id = ? AND user_id = ?
  `);

  const result = stmt.run(...values, activityId, userId);
  return result.changes > 0;
}

/**
 * Delete a recurring activity
 * Returns true if successful, false if not found
 */
export function deleteRecurringActivity(
  userId: string,
  activityId: number
): boolean {
  const stmt = db.prepare(`
    DELETE FROM recurring_activities
    WHERE id = ? AND user_id = ?
  `);

  const result = stmt.run(activityId, userId);
  return result.changes > 0;
}

/**
 * Delete all recurring activities for a user
 * Returns number of deleted activities
 */
export function deleteAllRecurringActivities(userId: string): number {
  const stmt = db.prepare(`
    DELETE FROM recurring_activities
    WHERE user_id = ?
  `);

  const result = stmt.run(userId);
  return result.changes;
}

/**
 * Check if a similar activity already exists (duplicate detection)
 * Returns matching activity if found, null otherwise
 *
 * Considers activities "similar" if they match:
 * - user_id, child, description (case-insensitive)
 * - Same days_of_week set (order doesn't matter)
 */
export function findSimilarActivity(
  activity: RecurringActivity
): RecurringActivity | null {
  const stmt = db.prepare(`
    SELECT * FROM recurring_activities
    WHERE user_id = ?
      AND child = ?
      AND LOWER(description) = LOWER(?)
  `);

  const rows = stmt.all(
    activity.user_id,
    activity.child,
    activity.description
  ) as RecurringActivityRow[];

  // Check each row for matching days_of_week
  for (const row of rows) {
    const existingDays = JSON.parse(row.days_of_week) as number[];
    const newDays = activity.days_of_week;

    // Compare days (order doesn't matter)
    const existingSet = new Set(existingDays);
    const newSet = new Set(newDays);

    if (
      existingSet.size === newSet.size &&
      [...existingSet].every((day) => newSet.has(day))
    ) {
      return rowToActivity(row);
    }
  }

  return null;
}

/**
 * Get activities that occur on a specific day of week
 * @param userId User ID
 * @param dayOfWeek Day of week (1=Monday, 7=Sunday)
 */
export function getActivitiesByDay(
  userId: string,
  dayOfWeek: number
): RecurringActivity[] {
  // Since days_of_week is stored as JSON, we need to fetch all and filter in JavaScript
  const allActivities = getRecurringActivities(userId);

  return allActivities.filter((activity) =>
    activity.days_of_week.includes(dayOfWeek)
  );
}

/**
 * Get activities that require kit on a specific day
 * @param userId User ID
 * @param dayOfWeek Day of week (1=Monday, 7=Sunday)
 */
export function getKitActivitiesByDay(
  userId: string,
  dayOfWeek: number
): RecurringActivity[] {
  const allActivities = getRecurringActivities(userId);

  return allActivities.filter(
    (activity) =>
      activity.requires_kit && activity.days_of_week.includes(dayOfWeek)
  );
}
