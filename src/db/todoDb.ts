// src/db/todoDb.ts
import db from './db.js';
import type { Todo } from '../types/todo.js';
import type { ExtractedTodo, TodoType } from '../types/extraction.js';

/**
 * Prepared statements for better performance and SQL injection protection
 * Created once and reused for all operations
 */

// INSERT statement for creating new todos (basic version)
const insertStmt = db.prepare(`
  INSERT INTO todos (user_id, description, due_date, status, type)
  VALUES (?, ?, ?, ?, ?)
`);

// INSERT statement for creating todos from AI extraction (legacy)
const insertExtractedStmt = db.prepare(`
  INSERT INTO todos (user_id, description, type, due_date, child_name, source_email_id, url, amount, confidence, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
`);

// INSERT statement for creating todos with enhanced fields (Task 1.9)
const insertEnhancedStmt = db.prepare(`
  INSERT INTO todos (user_id, description, type, due_date, child_name, source_email_id, url, amount, confidence, recurring, recurrence_pattern, responsible_party, inferred, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
`);

/**
 * Input type for creating todos with all fields
 */
export interface CreateTodoInput {
  description: string;
  type: TodoType;
  due_date?: string;
  child_name?: string;
  source_email_id?: string;
  url?: string;
  amount?: string;
  confidence?: number;
  recurring?: boolean;
  recurrence_pattern?: string;
  responsible_party?: string;
  inferred?: boolean;
}

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
 * Helper function to map database row to Todo object
 */
function mapRowToTodo(row: any): Todo {
  const todo: Todo = {
    id: row.id,
    user_id: row.user_id,
    description: row.description,
    type: (row.type || 'REMIND') as TodoType,
    status: row.status as 'pending' | 'done',
    created_at: new Date(row.created_at),
  };

  if (row.due_date) {
    todo.due_date = new Date(row.due_date);
  }

  if (row.child_name) {
    todo.child_name = row.child_name;
  }

  if (row.source_email_id) {
    todo.source_email_id = row.source_email_id;
  }

  if (row.url) {
    todo.url = row.url;
  }

  if (row.amount) {
    todo.amount = row.amount;
  }

  if (row.confidence !== null && row.confidence !== undefined) {
    todo.confidence = row.confidence;
  }

  if (row.completed_at) {
    todo.completed_at = new Date(row.completed_at);
  }

  if (row.auto_completed !== null && row.auto_completed !== undefined) {
    todo.auto_completed = Boolean(row.auto_completed);
  }

  // Enhanced fields (Task 1.9)
  if (row.recurring !== null && row.recurring !== undefined) {
    todo.recurring = Boolean(row.recurring);
  }

  if (row.recurrence_pattern) {
    todo.recurrence_pattern = row.recurrence_pattern;
  }

  if (row.responsible_party) {
    todo.responsible_party = row.responsible_party;
  }

  if (row.inferred !== null && row.inferred !== undefined) {
    todo.inferred = Boolean(row.inferred);
  }

  return todo;
}

/**
 * Create a todo with all fields (enhanced version)
 */
export function createTodoEnhanced(userId: string, input: CreateTodoInput): number {
  const result = insertEnhancedStmt.run(
    userId,
    input.description,
    input.type,
    input.due_date || null,
    input.child_name || null,
    input.source_email_id || null,
    input.url || null,
    input.amount || null,
    input.confidence || null,
    input.recurring ? 1 : 0,
    input.recurrence_pattern || null,
    input.responsible_party || null,
    input.inferred ? 1 : 0
  );
  return result.lastInsertRowid as number;
}

/**
 * Create a new TODO for a user
 *
 * @param userId - User ID from auth
 * @param description - TODO description
 * @param dueDate - Optional due date
 * @param status - Status (pending or done), defaults to pending
 * @param type - Todo type, defaults to REMIND
 * @returns ID of the created TODO
 */
export function createTodo(
  userId: string,
  description: string,
  dueDate?: Date,
  status: 'pending' | 'done' = 'pending',
  type: TodoType = 'REMIND'
): number {
  const result = insertStmt.run(
    userId,
    description,
    dueDate ? dueDate.toISOString() : null,
    status,
    type
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
  return rows.map(mapRowToTodo);
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
  return mapRowToTodo(row);
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

/**
 * Create todo from AI extraction
 *
 * @param userId - User ID
 * @param todo - Extracted todo from AI
 * @returns ID of created todo
 */
export function createTodoFromExtraction(
  userId: string,
  todo: ExtractedTodo
): number {
  const result = insertExtractedStmt.run(
    userId,
    todo.description,
    todo.type,
    todo.due_date || null,
    todo.child_name || null,
    todo.source_email_id || null,
    todo.url || null,
    todo.amount || null,
    todo.confidence
  );
  return result.lastInsertRowid as number;
}

/**
 * Batch create todos from AI extraction
 *
 * @param userId - User ID
 * @param todos - Array of extracted todos
 * @returns Array of created todo IDs
 */
export function createTodosBatch(
  userId: string,
  todos: ExtractedTodo[]
): number[] {
  const ids: number[] = [];
  const transaction = db.transaction(() => {
    for (const todo of todos) {
      const id = createTodoFromExtraction(userId, todo);
      ids.push(id);
    }
  });
  transaction();
  return ids;
}

/**
 * Get todos by type
 *
 * @param userId - User ID
 * @param type - Todo type to filter by
 * @returns Array of todos matching the type
 */
export function getTodosByType(userId: string, type: TodoType): Todo[] {
  const stmt = db.prepare(`
    SELECT * FROM todos
    WHERE user_id = ? AND type = ?
    ORDER BY due_date ASC NULLS LAST, created_at DESC
  `);
  const rows = stmt.all(userId, type) as any[];
  return rows.map(mapRowToTodo);
}

/**
 * Get todos by child
 *
 * @param userId - User ID
 * @param childName - Child name to filter by (null for general todos)
 * @returns Array of todos for the child
 */
export function getTodosByChild(
  userId: string,
  childName: string | null
): Todo[] {
  const stmt = db.prepare(`
    SELECT * FROM todos
    WHERE user_id = ? AND (child_name = ? OR (child_name IS NULL AND ? IS NULL))
    ORDER BY due_date ASC NULLS LAST, created_at DESC
  `);
  const rows = stmt.all(userId, childName, childName) as any[];
  return rows.map(mapRowToTodo);
}

/**
 * Get todos with filters
 *
 * @param userId - User ID
 * @param filters - Optional filters
 * @returns Array of filtered todos
 */
export interface TodoFilters {
  status?: 'pending' | 'done';
  type?: TodoType;
  childName?: string | null;
}

export function getTodos(userId: string, filters?: TodoFilters): Todo[] {
  let query = 'SELECT * FROM todos WHERE user_id = ?';
  const params: any[] = [userId];

  if (filters?.status) {
    query += ' AND status = ?';
    params.push(filters.status);
  }

  if (filters?.type) {
    query += ' AND type = ?';
    params.push(filters.type);
  }

  if (filters?.childName !== undefined) {
    if (filters.childName === null) {
      query += ' AND child_name IS NULL';
    } else {
      query += ' AND child_name = ?';
      params.push(filters.childName);
    }
  }

  query += ' ORDER BY due_date ASC NULLS LAST, created_at DESC';

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as any[];
  return rows.map(mapRowToTodo);
}

/**
 * Mark todo as complete with completion timestamp
 *
 * @param userId - User ID
 * @param id - Todo ID
 * @returns true if marked complete, false otherwise
 */
export function completeTodo(userId: string, id: number): boolean {
  const stmt = db.prepare(`
    UPDATE todos
    SET status = 'done', completed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `);
  const result = stmt.run(id, userId);
  return result.changes > 0;
}

/**
 * Mark all past pending todos as auto-completed
 * Used by cleanup to automatically complete todos that are past due
 *
 * @param userId - User ID
 * @param cutoffDate - Todos with due_date before this will be marked complete
 * @returns Array of todo IDs that were auto-completed
 */
export function markTodosAsAutoCompleted(userId: string, cutoffDate: Date): number[] {
  // First, get the IDs of todos that will be affected
  const selectStmt = db.prepare(`
    SELECT id FROM todos
    WHERE user_id = ?
      AND status = 'pending'
      AND due_date IS NOT NULL
      AND due_date < ?
  `);
  const rows = selectStmt.all(userId, cutoffDate.toISOString()) as { id: number }[];
  const ids = rows.map(r => r.id);

  if (ids.length === 0) {
    return [];
  }

  // Update all matching todos
  const updateStmt = db.prepare(`
    UPDATE todos
    SET status = 'done',
        completed_at = CURRENT_TIMESTAMP,
        auto_completed = 1
    WHERE user_id = ?
      AND status = 'pending'
      AND due_date IS NOT NULL
      AND due_date < ?
  `);
  updateStmt.run(userId, cutoffDate.toISOString());

  return ids;
}
