// src/utils/cleanupPastItems.ts
//
// Utility for cleaning up past todos and events
// Runs before email analysis to auto-complete/remove items that are >24 hours past

import { markTodosAsAutoCompleted } from '../db/todoDb.js';
import { deletePastEvents } from '../db/eventDb.js';

/**
 * Result of cleanup operation
 */
export interface CleanupResult {
  todosCompleted: number;
  eventsRemoved: number;
  todoIds: number[];
  eventIds: number[];
  cutoffDate: Date;
}

/**
 * Clean up past todos and events for a user
 *
 * - Todos with due_date before today (midnight) are marked as done with auto_completed=true
 * - Events with date before today (midnight) are deleted from the database
 *
 * @param userId - User ID to clean up items for
 * @returns CleanupResult with counts and IDs of affected items
 */
export function cleanupPastItems(userId: string): CleanupResult {
  // Calculate cutoff: midnight today (start of today)
  const cutoffDate = new Date();
  cutoffDate.setHours(0, 0, 0, 0);

  // Auto-complete past todos
  const todoIds = markTodosAsAutoCompleted(userId, cutoffDate);

  // Delete past events
  const eventIds = deletePastEvents(userId, cutoffDate);

  return {
    todosCompleted: todoIds.length,
    eventsRemoved: eventIds.length,
    todoIds,
    eventIds,
    cutoffDate,
  };
}
