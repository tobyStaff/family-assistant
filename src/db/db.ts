// src/db/db.ts
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

// Environment variable for DB path, defaults to ./data/app.db
// In Docker, this will be mounted as a volume for persistence
const DB_PATH = process.env.DB_PATH || join(process.cwd(), 'data', 'app.db');

// Ensure data directory exists
const dataDir = join(process.cwd(), 'data');
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

// Initialize database connection
// verbose: console.log can be removed in production for performance
const db = new Database(DB_PATH, {
  verbose: process.env.NODE_ENV === 'development' ? console.log : undefined
});

// Enable WAL (Write-Ahead Logging) mode for better concurrency
// WAL allows multiple readers and one writer simultaneously
// Critical for multi-tenant app with up to 2,000 users
db.pragma('journal_mode = WAL');

// Create tables if they don't exist
db.exec(`
  -- Auth table for storing encrypted OAuth tokens
  CREATE TABLE IF NOT EXISTS auth (
    user_id TEXT PRIMARY KEY,
    refresh_token TEXT NOT NULL,
    access_token TEXT,
    expiry_date DATETIME
  );

  -- Index on user_id for fast lookups (multi-tenancy)
  CREATE INDEX IF NOT EXISTS idx_auth_user_id ON auth(user_id);

  -- TODOs table for task management
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    description TEXT NOT NULL,
    due_date DATETIME,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'done')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Index on user_id for fast filtering by user (multi-tenancy)
  CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);

  -- Index on status for filtering by status
  CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
`);

console.log(`Database initialized at ${DB_PATH} with WAL mode`);

// Export singleton database connection
export default db;

/**
 * Close database connection
 * Should be called on application shutdown
 */
export function closeDatabase(): void {
  db.close();
  console.log('Database connection closed');
}
