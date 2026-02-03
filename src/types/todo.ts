// src/types/todo.ts

import type { TodoType } from './extraction.js';

/**
 * TODO item structure for SQLite storage
 */
export interface Todo {
  id: number;
  user_id: string; // UUID or string from auth
  description: string;
  type: TodoType; // Action category: PAY, BUY, PACK, SIGN, FILL, READ, REMIND
  due_date?: Date; // Optional due date
  status: 'pending' | 'done'; // Simple status for MVP
  child_name?: string; // Associated child (null = General)
  source_email_id?: string; // Link to processed_emails table
  url?: string; // Payment link or relevant URL
  amount?: string; // Amount for PAY type (e.g., "£15.00")
  confidence?: number; // AI confidence (0.0-1.0)
  created_at: Date;
  completed_at?: Date; // When marked as done
  auto_completed?: boolean; // True if auto-completed by cleanup (past due date)
  // Enhanced fields (Task 1.9)
  recurring?: boolean; // True if recurring task
  recurrence_pattern?: string; // E.g., "every Monday"
  responsible_party?: string; // "parent", "child", or "both"
  inferred?: boolean; // True if action was inferred by AI
}

/**
 * Auth entry for storing encrypted OAuth tokens
 * Stored separately from todos for security and maintainability
 */
export interface AuthEntry {
  user_id: string; // Primary key
  refresh_token: string; // Encrypted refresh token
  access_token?: string | undefined; // Encrypted access token (optional)
  expiry_date?: Date | undefined; // Token expiry date
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

/**
 * User profile from Google OAuth
 */
export interface UserProfile {
  user_id: string; // Google's 'sub' claim from id_token
  email: string;
  name?: string | undefined;
  picture_url?: string | undefined;
  created_at?: Date | undefined;
  updated_at?: Date | undefined;
  onboarding_step?: number;
  gmail_connected?: boolean;
  calendar_connected?: boolean;
}

/**
 * Session for cookie-based authentication
 */
export interface Session {
  session_id: string;
  user_id: string;
  expires_at: Date;
  created_at: Date;
}
