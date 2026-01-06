// src/db/todoDb.ts
import db from './db.js';
import type { Todo } from '../types/todo.js';

/**
 * Prepared statements for better performance and SQL injection protection
 * Created once and reused for all operations
 */

// INSERT statement for creating new todos
const insertStmt = db.prepare(`
  INSERT INTO todos (user_id, description, due_date, status)
  VALUES (?, ?, ?, ?)
`);

// SELECT statement for listing user's todos
const listStmt = db.prepare(`
  SELECT * FROM todos
  WHERE user_id = ?
  ORDER BY created_at DESC, id DESC
`);

// SELECT statement for getting a single todo
const getStmt = db.prepare(`
  SELECT * FROM todos
  WHERE id = ? AND user_id = ?
`);

// UPDATE statement for modifying todos
const updateStmt = db.prepare(`
  UPDATE todos
  SET description = ?, due_date = ?, status = ?
  WHERE id = ? AND user_id = ?
`);

// DELETE statement for removing todos
const deleteStmt = db.prepare(`
  DELETE FROM todos
  WHERE id = ? AND user_id = ?
`);

/**
 * Create a new TODO for a user
 *
 * @param userId - User ID from auth
 * @param description - TODO description
 * @param dueDate - Optional due date
 * @param status - Status (pending or done), defaults to pending
 * @returns ID of the created TODO
 */
export function createTodo(
  userId: string,
  description: string,
  dueDate?: Date,
  status: 'pending' | 'done' = 'pending'
): number {
  const result = insertStmt.run(
    userId,
    description,
    dueDate ? dueDate.toISOString() : null,
    status
  );
  return result.lastInsertRowid as number;
}

/**
 * List all TODOs for a user
 *
 * @param userId - User ID from auth
 * @returns Array of TODOs, sorted by creation date (newest first)
 */
export function listTodos(userId: string): Todo[] {
  const rows = listStmt.all(userId) as any[];
  return rows.map(row => ({
    id: row.id,
    user_id: row.user_id,
    description: row.description,
    due_date: row.due_date ? new Date(row.due_date) : undefined,
    status: row.status as 'pending' | 'done',
    created_at: new Date(row.created_at),
  }));
}

/**
 * Get a single TODO by ID
 *
 * @param userId - User ID from auth (for multi-tenant security)
 * @param id - TODO ID
 * @returns TODO if found and belongs to user, null otherwise
 */
export function getTodo(userId: string, id: number): Todo | null {
  const row = getStmt.get(id, userId) as any;
  if (!row) return null;

  return {
    id: row.id,
    user_id: row.user_id,
    description: row.description,
    due_date: row.due_date ? new Date(row.due_date) : undefined,
    status: row.status as 'pending' | 'done',
    created_at: new Date(row.created_at),
  };
}

/**
 * Update a TODO
 *
 * @param userId - User ID from auth (for multi-tenant security)
 * @param id - TODO ID
 * @param description - New description
 * @param dueDate - New due date (optional)
 * @param status - New status (optional)
 * @returns true if updated, false if not found or doesn't belong to user
 */
export function updateTodo(
  userId: string,
  id: number,
  description: string,
  dueDate?: Date,
  status?: 'pending' | 'done'
): boolean {
  const result = updateStmt.run(
    description,
    dueDate ? dueDate.toISOString() : null,
    status || 'pending',
    id,
    userId
  );
  return result.changes > 0;
}

/**
 * Delete a TODO
 *
 * @param userId - User ID from auth (for multi-tenant security)
 * @param id - TODO ID
 * @returns true if deleted, false if not found or doesn't belong to user
 */
export function deleteTodo(userId: string, id: number): boolean {
  const result = deleteStmt.run(id, userId);
  return result.changes > 0;
}

/**
 * Mark a TODO as done
 *
 * @param userId - User ID from auth
 * @param id - TODO ID
 * @returns true if marked as done, false if not found or doesn't belong to user
 */
export function markTodoAsDone(userId: string, id: number): boolean {
  const todo = getTodo(userId, id);
  if (!todo) return false;
  return updateTodo(userId, id, todo.description, todo.due_date, 'done');
}

/**
 * Mark a TODO as pending
 *
 * @param userId - User ID from auth
 * @param id - TODO ID
 * @returns true if marked as pending, false if not found or doesn't belong to user
 */
export function markTodoAsPending(userId: string, id: number): boolean {
  const todo = getTodo(userId, id);
  if (!todo) return false;
  return updateTodo(userId, id, todo.description, todo.due_date, 'pending');
}
