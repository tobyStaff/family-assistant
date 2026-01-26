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
const db: Database.Database = new Database(DB_PATH, {
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

  -- Processed emails table for idempotency (Deliverable 8)
  -- Tracks which emails have been processed to avoid duplicate actions
  CREATE TABLE IF NOT EXISTS processed_emails (
    email_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Index on user_id for fast lookups by user (multi-tenancy)
  CREATE INDEX IF NOT EXISTS idx_processed_user_id ON processed_emails(user_id);

  -- Users table for storing Google profile information
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    picture_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Index on email for fast lookups by email
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

  -- Sessions table for cookie-based authentication
  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  );

  -- Index on user_id for fast lookups by user
  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

  -- Index on expires_at for efficient cleanup of expired sessions
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

  -- User settings table for configuring daily summary preferences
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY,
    summary_email_recipients TEXT,  -- JSON array of email addresses
    summary_enabled BOOLEAN DEFAULT 1,
    summary_time_utc INTEGER DEFAULT 8,  -- Hour in UTC (0-23)
    timezone TEXT DEFAULT 'UTC',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  );

  -- Email summaries table for storing generated summaries
  CREATE TABLE IF NOT EXISTS email_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    summary_date DATE NOT NULL,
    inbox_count INTEGER,
    summary_json TEXT,  -- Full AI-generated summary
    sent_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE(user_id, summary_date)
  );

  -- Index on user_id for fast lookups
  CREATE INDEX IF NOT EXISTS idx_email_summaries_user_id ON email_summaries(user_id);

  -- Index on summary_date for date-based queries
  CREATE INDEX IF NOT EXISTS idx_email_summaries_date ON email_summaries(summary_date);

  -- AI metrics table for tracking performance and quality
  CREATE TABLE IF NOT EXISTS ai_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    provider TEXT NOT NULL,  -- 'openai' or 'anthropic'

    -- Email processing stats
    emails_total INTEGER NOT NULL,
    emails_signal INTEGER NOT NULL,
    emails_noise INTEGER NOT NULL,

    -- Content extraction stats
    attachments_total INTEGER,
    attachments_extracted INTEGER,
    attachments_failed INTEGER,

    -- AI output quality
    validation_passed BOOLEAN NOT NULL,
    validation_errors TEXT,  -- JSON array of error messages

    -- Response timing
    response_time_ms INTEGER,  -- Total AI API call time

    -- Output stats
    financials_count INTEGER,
    calendar_updates_count INTEGER,
    attachments_review_count INTEGER,
    kit_tomorrow_count INTEGER,

    -- Schema validation (OpenAI only)
    schema_validated BOOLEAN DEFAULT 0,

    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  );

  -- Index on user_id for per-user metrics
  CREATE INDEX IF NOT EXISTS idx_ai_metrics_user_id ON ai_metrics(user_id);

  -- Index on timestamp for time-series queries
  CREATE INDEX IF NOT EXISTS idx_ai_metrics_timestamp ON ai_metrics(timestamp);

  -- Index on provider for provider comparison
  CREATE INDEX IF NOT EXISTS idx_ai_metrics_provider ON ai_metrics(provider);

  -- ====================
  -- RECURRING ACTIVITIES TABLE
  -- ====================
  -- Stores recurring school activities detected from emails (e.g., "PE on Mondays and Tuesdays")
  CREATE TABLE IF NOT EXISTS recurring_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    description TEXT NOT NULL,        -- Activity name (e.g., "PE", "Swimming club")
    child TEXT NOT NULL,               -- Child's name
    days_of_week TEXT NOT NULL,        -- JSON array: [1, 2] for Monday, Tuesday (1=Mon, 7=Sun)
    frequency TEXT NOT NULL,           -- "weekly" for now (future: "biweekly")
    requires_kit BOOLEAN NOT NULL,     -- Whether kit/equipment is needed
    kit_items TEXT NOT NULL DEFAULT '[]', -- JSON array of items (empty array if none): ["PE kit", "trainers"]
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  );

  -- Index on user_id for per-user queries
  CREATE INDEX IF NOT EXISTS idx_recurring_user ON recurring_activities(user_id);

  -- Index on child for per-child queries
  CREATE INDEX IF NOT EXISTS idx_recurring_child ON recurring_activities(child);

  -- ====================
  -- CHILD PROFILES TABLE
  -- ====================
  -- Stores child profile information extracted from school emails
  CREATE TABLE IF NOT EXISTS child_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    real_name TEXT NOT NULL,              -- Actual name from emails (e.g., "Ella")
    display_name TEXT,                    -- Optional alias for privacy (e.g., "Child A")
    year_group TEXT,                      -- School year (e.g., "Year 3", "Reception")
    school_name TEXT,                     -- School name
    is_active BOOLEAN DEFAULT 1,          -- Active enrollment status
    onboarding_completed BOOLEAN DEFAULT 0, -- Whether user confirmed this profile
    confidence_score REAL,                -- AI confidence (0.0-1.0) from initial extraction
    notes TEXT,                           -- User notes
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  );

  -- Index on user_id for per-user queries
  CREATE INDEX IF NOT EXISTS idx_child_profiles_user ON child_profiles(user_id);

  -- Index on is_active for active children queries
  CREATE INDEX IF NOT EXISTS idx_child_profiles_active ON child_profiles(is_active);

  -- Schema version tracking for migrations
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    description TEXT
  );
`);

/**
 * Run database migrations
 */
function runMigrations() {
  // Get current schema version
  const currentVersion = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null };
  const version = currentVersion?.version || 0;

  // Migration 1: Add type and tracking columns to todos table
  if (version < 1) {
    console.log('Running migration 1: Adding type and tracking columns to todos table');

    db.transaction(() => {
      // Add new columns (all nullable for backwards compatibility)
      db.exec(`
        ALTER TABLE todos ADD COLUMN type TEXT DEFAULT 'REMIND'
          CHECK(type IN ('PAY', 'BUY', 'PACK', 'SIGN', 'FILL', 'READ', 'REMIND'));
      `);
      db.exec(`ALTER TABLE todos ADD COLUMN child_name TEXT;`);
      db.exec(`ALTER TABLE todos ADD COLUMN source_email_id TEXT;`);
      db.exec(`ALTER TABLE todos ADD COLUMN url TEXT;`);
      db.exec(`ALTER TABLE todos ADD COLUMN amount TEXT;`);
      db.exec(`ALTER TABLE todos ADD COLUMN confidence REAL;`);
      db.exec(`ALTER TABLE todos ADD COLUMN completed_at DATETIME;`);

      // Create new indexes
      db.exec(`CREATE INDEX IF NOT EXISTS idx_todos_type ON todos(type);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_todos_child ON todos(child_name);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);`);

      // Record migration
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        1,
        'Add type, child_name, source_email_id, url, amount, confidence, completed_at to todos table'
      );
    })();

    console.log('Migration 1 completed');
  }

  // Migration 2: Create events table with sync tracking
  if (version < 2) {
    console.log('Running migration 2: Creating events table with sync tracking');

    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,

          -- Event data from ExtractedEvent
          title TEXT NOT NULL,
          date TEXT NOT NULL,
          end_date TEXT,
          description TEXT,
          location TEXT,
          child_name TEXT,
          source_email_id TEXT,
          confidence REAL,

          -- Sync tracking
          sync_status TEXT NOT NULL DEFAULT 'pending'
            CHECK(sync_status IN ('pending', 'synced', 'failed')),
          google_calendar_event_id TEXT,
          last_sync_attempt DATETIME,
          sync_error TEXT,
          retry_count INTEGER DEFAULT 0,

          -- Timestamps
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          synced_at DATETIME,

          FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
        );

        -- Indexes for performance
        CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);
        CREATE INDEX IF NOT EXISTS idx_events_sync_status ON events(sync_status);
        CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
        CREATE INDEX IF NOT EXISTS idx_events_child ON events(child_name);
        CREATE INDEX IF NOT EXISTS idx_events_google_id ON events(google_calendar_event_id);

        -- Unique constraint for duplicate prevention
        CREATE UNIQUE INDEX IF NOT EXISTS idx_events_unique
          ON events(user_id, source_email_id, title, date)
          WHERE source_email_id IS NOT NULL;
      `);

      // Record migration
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        2,
        'Create events table with Google Calendar sync tracking'
      );
    })();

    console.log('Migration 2 completed');
  }

  // Migration 3: Create emails table for persistent email storage
  if (version < 3) {
    console.log('Running migration 3: Creating emails table for persistent storage');

    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS emails (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,

          -- Gmail metadata
          gmail_message_id TEXT NOT NULL,
          gmail_thread_id TEXT,

          -- Email content
          from_email TEXT NOT NULL,
          from_name TEXT,
          subject TEXT NOT NULL,
          date DATETIME NOT NULL,
          body_text TEXT,
          snippet TEXT,
          labels TEXT,

          -- Attachment content (extracted and merged)
          has_attachments BOOLEAN DEFAULT 0,
          attachment_content TEXT,

          -- Processing flags
          processed BOOLEAN DEFAULT 0,
          analyzed BOOLEAN DEFAULT 0,

          -- Gmail sync
          gmail_labeled BOOLEAN DEFAULT 0,

          -- Error tracking
          fetch_error TEXT,
          fetch_attempts INTEGER DEFAULT 0,

          -- Timestamps
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

          FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
        );

        -- Indexes for performance
        CREATE INDEX IF NOT EXISTS idx_emails_user_id ON emails(user_id);
        CREATE INDEX IF NOT EXISTS idx_emails_gmail_id ON emails(gmail_message_id);
        CREATE INDEX IF NOT EXISTS idx_emails_processed ON emails(processed);
        CREATE INDEX IF NOT EXISTS idx_emails_analyzed ON emails(analyzed);
        CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date);

        -- Unique constraint to prevent duplicate emails
        CREATE UNIQUE INDEX IF NOT EXISTS idx_emails_unique
          ON emails(user_id, gmail_message_id);
      `);

      // Record migration
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        3,
        'Create emails table for persistent email storage with processing flags'
      );
    })();

    console.log('Migration 3 completed');
  }

  // Migration 4: Add recurring/inference columns and create email_analyses table
  if (version < 4) {
    console.log('Running migration 4: Adding recurring/inference columns and email_analyses table');

    db.transaction(() => {
      // Add recurring and inference columns to todos table
      db.exec(`ALTER TABLE todos ADD COLUMN recurring BOOLEAN DEFAULT 0;`);
      db.exec(`ALTER TABLE todos ADD COLUMN recurrence_pattern TEXT;`);
      db.exec(`ALTER TABLE todos ADD COLUMN responsible_party TEXT;`);
      db.exec(`ALTER TABLE todos ADD COLUMN inferred BOOLEAN DEFAULT 0;`);

      // Add recurring and inference columns to events table
      db.exec(`ALTER TABLE events ADD COLUMN recurring BOOLEAN DEFAULT 0;`);
      db.exec(`ALTER TABLE events ADD COLUMN recurrence_pattern TEXT;`);
      db.exec(`ALTER TABLE events ADD COLUMN time_of_day TEXT;`);
      db.exec(`ALTER TABLE events ADD COLUMN inferred_date BOOLEAN DEFAULT 0;`);

      // Create indexes for recurring queries
      db.exec(`CREATE INDEX IF NOT EXISTS idx_todos_recurring ON todos(recurring);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_events_recurring ON events(recurring);`);

      // Create email_analyses table for two-pass analysis (Task 2)
      db.exec(`
        CREATE TABLE IF NOT EXISTS email_analyses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,

          -- Link to stored email
          email_id INTEGER NOT NULL,

          -- Analysis metadata
          analysis_version INTEGER DEFAULT 1,
          ai_provider TEXT NOT NULL,

          -- Human analysis section
          email_summary TEXT,
          email_tone TEXT,
          email_intent TEXT,
          implicit_context TEXT,

          -- Raw AI output
          raw_extraction_json TEXT,

          -- Quality scoring
          quality_score REAL,
          confidence_avg REAL,

          -- Processing stats
          events_extracted INTEGER DEFAULT 0,
          todos_extracted INTEGER DEFAULT 0,
          recurring_items INTEGER DEFAULT 0,
          inferred_items INTEGER DEFAULT 0,

          -- Status tracking
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'analyzed', 'reviewed', 'approved', 'rejected')),
          reviewed_by TEXT,
          reviewed_at DATETIME,
          review_notes TEXT,

          -- Error tracking
          analysis_error TEXT,
          retry_count INTEGER DEFAULT 0,

          -- Timestamps
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

          FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
          FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE
        );

        -- Indexes for performance
        CREATE INDEX IF NOT EXISTS idx_email_analyses_user_id ON email_analyses(user_id);
        CREATE INDEX IF NOT EXISTS idx_email_analyses_email_id ON email_analyses(email_id);
        CREATE INDEX IF NOT EXISTS idx_email_analyses_status ON email_analyses(status);
        CREATE INDEX IF NOT EXISTS idx_email_analyses_quality ON email_analyses(quality_score);

        -- Unique constraint: one analysis per email per version
        CREATE UNIQUE INDEX IF NOT EXISTS idx_email_analyses_unique
          ON email_analyses(email_id, analysis_version);
      `);

      // Record migration
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        4,
        'Add recurring/inference columns to todos and events, create email_analyses table'
      );
    })();

    console.log('Migration 4 completed');
  }

  // Migration 5: Create email_action_tokens table for token-based email actions
  if (version < 5) {
    console.log('Running migration 5: Creating email_action_tokens table');

    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS email_action_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          token TEXT NOT NULL UNIQUE,
          user_id TEXT NOT NULL,
          action_type TEXT NOT NULL CHECK(action_type IN ('complete_todo', 'remove_event')),
          target_id INTEGER NOT NULL,
          expires_at DATETIME NOT NULL,
          used_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

          FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
        );

        -- Index for token lookups
        CREATE INDEX IF NOT EXISTS idx_action_tokens_token ON email_action_tokens(token);

        -- Index for cleanup queries
        CREATE INDEX IF NOT EXISTS idx_action_tokens_expires ON email_action_tokens(expires_at);

        -- Index for user queries
        CREATE INDEX IF NOT EXISTS idx_action_tokens_user ON email_action_tokens(user_id);
      `);

      // Record migration
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        5,
        'Create email_action_tokens table for token-based email actions'
      );
    })();

    console.log('Migration 5 completed');
  }

  // Migration 6: Add auto_completed column to todos table
  if (version < 6) {
    console.log('Running migration 6: Adding auto_completed column to todos table');

    db.transaction(() => {
      db.exec(`ALTER TABLE todos ADD COLUMN auto_completed INTEGER DEFAULT 0;`);

      // Record migration
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        6,
        'Add auto_completed column to todos table for tracking automatic completions'
      );
    })();

    console.log('Migration 6 completed');
  }

  // Migration 7: Add roles column to users table for RBAC
  if (version < 7) {
    console.log('Running migration 7: Adding roles column to users table');

    db.transaction(() => {
      // Add roles column - JSON array of role strings, defaults to ["STANDARD"]
      db.exec(`ALTER TABLE users ADD COLUMN roles TEXT DEFAULT '["STANDARD"]';`);

      // Grant all roles to super admin email
      db.prepare(`
        UPDATE users
        SET roles = '["STANDARD", "ADMIN", "SUPER_ADMIN"]'
        WHERE email = ?
      `).run('tobystafford.assistant@gmail.com');

      // Record migration
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        7,
        'Add roles column to users table for role-based access control (RBAC)'
      );
    })();

    console.log('Migration 7 completed');
  }
}

// Run migrations after initial table creation
runMigrations();

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
