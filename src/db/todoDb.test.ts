// src/db/todoDb.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// Mock the db import with a factory function
vi.mock('./db.js', () => {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');

  // Create tables for testing
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      description TEXT NOT NULL,
      due_date DATETIME,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'done')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);
    CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
  `);

  return {
    default: testDb,
  };
});

// Import functions after mocking
import {
  createTodo,
  listTodos,
  getTodo,
  updateTodo,
  deleteTodo,
  markTodoAsDone,
  markTodoAsPending,
} from './todoDb.js';
import db from './db.js';

const testDb = db as Database.Database;

describe('todoDb', () => {
  beforeEach(() => {
    // Clear todos table before each test
    testDb.exec('DELETE FROM todos');
  });

  describe('createTodo', () => {
    it('should create a new todo and return its ID', () => {
      const id = createTodo('user1', 'Test task');
      expect(id).toBeGreaterThan(0);
    });

    it('should create todo with due date and status', () => {
      const dueDate = new Date('2026-01-15T10:00:00Z');
      const id = createTodo('user1', 'Task with due date', dueDate, 'pending');
      expect(id).toBeGreaterThan(0);

      const todo = getTodo('user1', id);
      expect(todo).toBeDefined();
      expect(todo?.description).toBe('Task with due date');
      expect(todo?.due_date).toBeInstanceOf(Date);
      expect(todo?.status).toBe('pending');
    });

    it('should default status to pending', () => {
      const id = createTodo('user1', 'Default status task');
      const todo = getTodo('user1', id);
      expect(todo?.status).toBe('pending');
    });
  });

  describe('listTodos', () => {
    it('should return empty array when no todos', () => {
      const todos = listTodos('user1');
      expect(todos).toEqual([]);
    });

    it('should list all todos for a user', () => {
      createTodo('user1', 'Task 1');
      createTodo('user1', 'Task 2');
      createTodo('user1', 'Task 3');

      const todos = listTodos('user1');
      expect(todos).toHaveLength(3);
      expect(todos[0]?.description).toBe('Task 3'); // Newest first
      expect(todos[1]?.description).toBe('Task 2');
      expect(todos[2]?.description).toBe('Task 1');
    });

    it('should not return todos from other users (multi-tenancy)', () => {
      createTodo('user1', 'User 1 task');
      createTodo('user2', 'User 2 task');

      const user1Todos = listTodos('user1');
      const user2Todos = listTodos('user2');

      expect(user1Todos).toHaveLength(1);
      expect(user1Todos[0]?.description).toBe('User 1 task');

      expect(user2Todos).toHaveLength(1);
      expect(user2Todos[0]?.description).toBe('User 2 task');
    });

    it('should parse dates correctly', () => {
      const dueDate = new Date('2026-01-15T10:00:00Z');
      createTodo('user1', 'Task with date', dueDate);

      const todos = listTodos('user1');
      expect(todos[0]?.due_date).toBeInstanceOf(Date);
      expect(todos[0]?.created_at).toBeInstanceOf(Date);
    });
  });

  describe('getTodo', () => {
    it('should get a todo by ID', () => {
      const id = createTodo('user1', 'Get task');
      const todo = getTodo('user1', id);

      expect(todo).toBeDefined();
      expect(todo?.id).toBe(id);
      expect(todo?.description).toBe('Get task');
      expect(todo?.user_id).toBe('user1');
    });

    it('should return null for non-existent todo', () => {
      const todo = getTodo('user1', 999);
      expect(todo).toBeNull();
    });

    it('should return null when accessing another user\'s todo', () => {
      const id = createTodo('user1', 'User 1 task');
      const todo = getTodo('user2', id);
      expect(todo).toBeNull();
    });
  });

  describe('updateTodo', () => {
    it('should update todo description', () => {
      const id = createTodo('user1', 'Original description');
      const success = updateTodo('user1', id, 'Updated description');

      expect(success).toBe(true);

      const todo = getTodo('user1', id);
      expect(todo?.description).toBe('Updated description');
    });

    it('should update todo status', () => {
      const id = createTodo('user1', 'Task to complete');
      const success = updateTodo('user1', id, 'Task to complete', undefined, 'done');

      expect(success).toBe(true);

      const todo = getTodo('user1', id);
      expect(todo?.status).toBe('done');
    });

    it('should update todo due date', () => {
      const id = createTodo('user1', 'Task');
      const newDueDate = new Date('2026-02-01T10:00:00Z');
      const success = updateTodo('user1', id, 'Task', newDueDate);

      expect(success).toBe(true);

      const todo = getTodo('user1', id);
      expect(todo?.due_date).toBeInstanceOf(Date);
      expect(todo?.due_date?.toISOString()).toBe(newDueDate.toISOString());
    });

    it('should return false for non-existent todo', () => {
      const success = updateTodo('user1', 999, 'Update');
      expect(success).toBe(false);
    });

    it('should return false when updating another user\'s todo', () => {
      const id = createTodo('user1', 'User 1 task');
      const success = updateTodo('user2', id, 'Attempted update');
      expect(success).toBe(false);
    });
  });

  describe('deleteTodo', () => {
    it('should delete a todo', () => {
      const id = createTodo('user1', 'Task to delete');
      const success = deleteTodo('user1', id);

      expect(success).toBe(true);

      const todo = getTodo('user1', id);
      expect(todo).toBeNull();
    });

    it('should return false for non-existent todo', () => {
      const success = deleteTodo('user1', 999);
      expect(success).toBe(false);
    });

    it('should return false when deleting another user\'s todo', () => {
      const id = createTodo('user1', 'User 1 task');
      const success = deleteTodo('user2', id);
      expect(success).toBe(false);

      // Verify it still exists for user1
      const todo = getTodo('user1', id);
      expect(todo).toBeDefined();
    });
  });

  describe('markTodoAsDone', () => {
    it('should mark todo as done', () => {
      const id = createTodo('user1', 'Task to complete');
      const success = markTodoAsDone('user1', id);

      expect(success).toBe(true);

      const todo = getTodo('user1', id);
      expect(todo?.status).toBe('done');
    });

    it('should return false for non-existent todo', () => {
      const success = markTodoAsDone('user1', 999);
      expect(success).toBe(false);
    });
  });

  describe('markTodoAsPending', () => {
    it('should mark todo as pending', () => {
      const id = createTodo('user1', 'Done task', undefined, 'done');
      const success = markTodoAsPending('user1', id);

      expect(success).toBe(true);

      const todo = getTodo('user1', id);
      expect(todo?.status).toBe('pending');
    });

    it('should return false for non-existent todo', () => {
      const success = markTodoAsPending('user1', 999);
      expect(success).toBe(false);
    });
  });

  describe('multi-tenancy isolation', () => {
    it('should completely isolate users', () => {
      // Create todos for multiple users
      const user1Id1 = createTodo('user1', 'User 1 - Task 1');
      createTodo('user1', 'User 1 - Task 2');
      const user2Id1 = createTodo('user2', 'User 2 - Task 1');
      const user3Id1 = createTodo('user3', 'User 3 - Task 1');

      // Verify each user only sees their todos
      expect(listTodos('user1')).toHaveLength(2);
      expect(listTodos('user2')).toHaveLength(1);
      expect(listTodos('user3')).toHaveLength(1);

      // Verify cross-user operations fail
      expect(deleteTodo('user2', user1Id1)).toBe(false);
      expect(updateTodo('user3', user2Id1, 'Hack attempt')).toBe(false);
      expect(getTodo('user1', user3Id1)).toBeNull();
    });
  });

  describe('date handling', () => {
    it('should handle todos without due dates', () => {
      const id = createTodo('user1', 'No due date');
      const todo = getTodo('user1', id);

      expect(todo?.due_date).toBeUndefined();
    });

    it('should correctly store and retrieve dates', () => {
      const dueDate = new Date('2026-06-15T14:30:00Z');
      const id = createTodo('user1', 'Date task', dueDate);
      const todo = getTodo('user1', id);

      expect(todo?.due_date).toBeInstanceOf(Date);
      expect(todo?.due_date?.getTime()).toBe(dueDate.getTime());
    });

    it('should have created_at timestamp', () => {
      const id = createTodo('user1', 'Timestamped task');
      const todo = getTodo('user1', id);

      expect(todo?.created_at).toBeInstanceOf(Date);
      expect(todo?.created_at.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });
});
