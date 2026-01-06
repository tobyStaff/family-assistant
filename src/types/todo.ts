// src/types/todo.ts

/**
 * TODO item structure for SQLite storage
 */
export interface Todo {
  id: number;
  user_id: string; // UUID or string from auth
  description: string;
  due_date?: Date; // Optional due date
  status: 'pending' | 'done'; // Simple status for MVP
  created_at: Date;
}

/**
 * Auth entry for storing encrypted OAuth tokens
 * Stored separately from todos for security and maintainability
 */
export interface AuthEntry {
  user_id: string; // Primary key
  refresh_token: string; // Encrypted refresh token
  access_token?: string; // Encrypted access token (optional)
  expiry_date?: Date; // Token expiry date
}

/**
 * Input for creating a new TODO
 */
export interface CreateTodoInput {
  description: string;
  due_date?: Date;
  status?: 'pending' | 'done';
}

/**
 * Input for updating an existing TODO
 */
export interface UpdateTodoInput {
  description: string;
  due_date?: Date;
  status?: 'pending' | 'done';
}
