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

  // Migration 8: Add attachment_extraction_failed column to emails table
  if (version < 8) {
    console.log('Running migration 8: Adding attachment_extraction_failed column to emails table');

    db.transaction(() => {
      // Add column to track attachment extraction failures
      db.exec(`ALTER TABLE emails ADD COLUMN attachment_extraction_failed BOOLEAN DEFAULT 0;`);

      // Create index for filtering failed extractions
      db.exec(`CREATE INDEX IF NOT EXISTS idx_emails_attachment_failed ON emails(attachment_extraction_failed);`);

      // Record migration
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        8,
        'Add attachment_extraction_failed column to emails table for tracking PDF/attachment failures'
      );
    })();

    console.log('Migration 8 completed');
  }

  // Migration 9: Create email_attachments table for storing original attachments
  if (version < 9) {
    console.log('Running migration 9: Creating email_attachments table for original file storage');

    db.transaction(() => {
      // Create email_attachments table to track individual attachments
      db.exec(`
        CREATE TABLE IF NOT EXISTS email_attachments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email_id INTEGER NOT NULL,

          -- Attachment metadata
          filename TEXT NOT NULL,
          mime_type TEXT,
          size INTEGER,

          -- Storage location (relative path from data/attachments/)
          storage_path TEXT NOT NULL,

          -- Extraction tracking
          extraction_status TEXT DEFAULT 'pending'
            CHECK(extraction_status IN ('pending', 'success', 'failed', 'skipped')),
          extraction_error TEXT,
          extracted_text TEXT,

          -- Timestamps
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

          FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE
        );

        -- Indexes for performance
        CREATE INDEX IF NOT EXISTS idx_email_attachments_email_id ON email_attachments(email_id);
        CREATE INDEX IF NOT EXISTS idx_email_attachments_status ON email_attachments(extraction_status);
        CREATE INDEX IF NOT EXISTS idx_email_attachments_failed
          ON email_attachments(extraction_status) WHERE extraction_status = 'failed';
      `);

      // Add column to emails table to track if attachments are stored
      db.exec(`ALTER TABLE emails ADD COLUMN attachments_stored BOOLEAN DEFAULT 0;`);

      // Record migration
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        9,
        'Create email_attachments table for storing original attachment files with extraction tracking'
      );
    })();

    console.log('Migration 9 completed');
  }

  // Migration 10: Add hosted email support
  if (version < 10) {
    console.log('Running migration 10: Adding hosted email support');

    db.transaction(() => {
      // 1. Add hosted email alias to users (user-chosen)
      // e.g., "toby" for toby@inbox.getfamilyassistant.com
      // Note: SQLite doesn't support UNIQUE in ALTER TABLE, so we add unique index separately
      db.exec(`ALTER TABLE users ADD COLUMN hosted_email_alias TEXT;`);

      // 2. Add email source preference to settings
      // 'gmail' = fetch from Gmail API, 'hosted' = receive via webhook
      db.exec(`ALTER TABLE user_settings ADD COLUMN email_source TEXT DEFAULT 'gmail' CHECK(email_source IN ('gmail', 'hosted'));`);

      // 3. Add source tracking to emails table
      db.exec(`ALTER TABLE emails ADD COLUMN source_type TEXT DEFAULT 'gmail' CHECK(source_type IN ('gmail', 'hosted'));`);
      db.exec(`ALTER TABLE emails ADD COLUMN source_message_id TEXT;`);

      // 4. Backfill source_message_id from gmail_message_id for existing emails
      db.exec(`UPDATE emails SET source_message_id = gmail_message_id WHERE source_type = 'gmail';`);

      // 5. Create index for source-based queries
      db.exec(`CREATE INDEX IF NOT EXISTS idx_emails_source ON emails(source_type);`);

      // 6. Create unique index on hosted_email_alias for fast lookups and uniqueness
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_hosted_alias ON users(hosted_email_alias);`);

      // Record migration
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        10,
        'Add hosted email support with user-chosen aliases and email source tracking'
      );
    })();

    console.log('Migration 10 completed');
  }

  if (version < 11) {
    console.log('Running migration 11: Adding class_name and clubs to child_profiles');

    db.transaction(() => {
      // Add class_name for identifying which class the child is in (e.g., "Elm", "Lime")
      db.exec(`ALTER TABLE child_profiles ADD COLUMN class_name TEXT;`);

      // Add clubs as JSON array (e.g., ["Rocksteady", "Swimming"])
      db.exec(`ALTER TABLE child_profiles ADD COLUMN clubs TEXT DEFAULT '[]';`);

      // Record migration
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        11,
        'Add class_name and clubs fields to child_profiles for better event matching'
      );
    })();

    console.log('Migration 11 completed');
  }

  // Migration 12: Add onboarding tracking and sender filters
  if (version < 12) {
    console.log('Running migration 12: Adding onboarding tracking, gmail_connected, and sender_filters');

    db.transaction(() => {
      // Track onboarding progress (0=not started, 1=account created, 2=gmail connected, 3=senders selected, 4=children confirmed, 5=complete)
      db.exec(`ALTER TABLE users ADD COLUMN onboarding_step INTEGER DEFAULT 0;`);

      // Track whether user has granted Gmail permissions
      db.exec(`ALTER TABLE users ADD COLUMN gmail_connected BOOLEAN DEFAULT 0;`);

      // Backfill existing users: if they have auth tokens, they've completed onboarding
      db.exec(`
        UPDATE users SET onboarding_step = 5, gmail_connected = 1
        WHERE user_id IN (SELECT user_id FROM auth);
      `);

      // Sender filters table for include/exclude lists
      db.exec(`
        CREATE TABLE IF NOT EXISTS sender_filters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          sender_email TEXT NOT NULL,
          sender_name TEXT,
          status TEXT NOT NULL CHECK(status IN ('include', 'exclude')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
          UNIQUE(user_id, sender_email)
        );

        CREATE INDEX IF NOT EXISTS idx_sender_filters_user ON sender_filters(user_id);
        CREATE INDEX IF NOT EXISTS idx_sender_filters_status ON sender_filters(user_id, status);
      `);

      // Record migration
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        12,
        'Add onboarding_step, gmail_connected to users and create sender_filters table'
      );
    })();

    console.log('Migration 12 completed');
  }

  if (version < 13) {
    console.log('Running migration 13: Adding relevance_feedback table for AI training');

    db.transaction(() => {
      // Relevance feedback table for training AI on what's relevant
      db.exec(`
        CREATE TABLE IF NOT EXISTS relevance_feedback (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          item_type TEXT NOT NULL CHECK(item_type IN ('todo', 'event')),
          item_text TEXT NOT NULL,
          source_sender TEXT,
          source_subject TEXT,
          is_relevant INTEGER,  -- NULL = ungraded, 1 = relevant, 0 = not relevant
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_relevance_feedback_user ON relevance_feedback(user_id);
        CREATE INDEX IF NOT EXISTS idx_relevance_feedback_graded ON relevance_feedback(user_id, is_relevant);
      `);

      // Record migration
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        13,
        'Add relevance_feedback table for AI training during onboarding'
      );
    })();

    console.log('Migration 13 completed');
  }

  // Migration 14: Add sender scoring columns for relevance tracking
  if (version < 14) {
    console.log('Running migration 14: Adding sender scoring columns to sender_filters');

    db.transaction(() => {
      // Add relevance scoring columns to sender_filters
      db.exec(`ALTER TABLE sender_filters ADD COLUMN relevance_score REAL;`);
      db.exec(`ALTER TABLE sender_filters ADD COLUMN relevant_count INTEGER DEFAULT 0;`);
      db.exec(`ALTER TABLE sender_filters ADD COLUMN not_relevant_count INTEGER DEFAULT 0;`);
      db.exec(`ALTER TABLE sender_filters ADD COLUMN last_score_update DATETIME;`);

      // Create index for filtering by score
      db.exec(`CREATE INDEX IF NOT EXISTS idx_sender_filters_score ON sender_filters(user_id, relevance_score);`);

      // Record migration
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        14,
        'Add relevance_score, relevant_count, not_relevant_count, last_score_update to sender_filters'
      );
    })();

    console.log('Migration 14 completed');
  }

  // Migration 15: Add calendar_connected field to users table
  if (version < 15) {
    console.log('Running migration 15: Adding calendar_connected field to users table');

    db.transaction(() => {
      // Add calendar_connected column - defaults to false for new users
      // Existing users who had calendar access via the old combined OAuth will need to re-authenticate
      db.exec(`ALTER TABLE users ADD COLUMN calendar_connected BOOLEAN DEFAULT 0;`);

      // Record migration
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        15,
        'Add calendar_connected field to users table for separate Google Calendar integration'
      );
    })();

    console.log('Migration 15 completed');
  }

  // Migration 16: Update todos type CHECK constraint to include DECIDE
  if (version < 16) {
    console.log('Running migration 16: Updating todos type CHECK constraint to include DECIDE');

    db.transaction(() => {
      // SQLite doesn't allow modifying CHECK constraints directly.
      // The constraint from migration 1 was added via ALTER TABLE, which SQLite
      // often doesn't enforce. We'll recreate the table to ensure the constraint is correct.

      // 1. Create new table with updated CHECK constraint
      db.exec(`
        CREATE TABLE todos_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          description TEXT NOT NULL,
          due_date DATETIME,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'done')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          type TEXT DEFAULT 'REMIND' CHECK(type IN ('PAY', 'BUY', 'PACK', 'SIGN', 'FILL', 'READ', 'DECIDE', 'REMIND')),
          child_name TEXT,
          source_email_id TEXT,
          url TEXT,
          amount TEXT,
          confidence REAL,
          completed_at DATETIME,
          auto_completed BOOLEAN DEFAULT 0,
          recurring BOOLEAN DEFAULT 0,
          recurrence_pattern TEXT,
          responsible_party TEXT,
          inferred BOOLEAN DEFAULT 0
        );
      `);

      // 2. Copy all data from old table
      db.exec(`
        INSERT INTO todos_new (
          id, user_id, description, due_date, status, created_at,
          type, child_name, source_email_id, url, amount, confidence,
          completed_at, auto_completed, recurring, recurrence_pattern,
          responsible_party, inferred
        )
        SELECT
          id, user_id, description, due_date, status, created_at,
          type, child_name, source_email_id, url, amount, confidence,
          completed_at, auto_completed, recurring, recurrence_pattern,
          responsible_party, inferred
        FROM todos;
      `);

      // 3. Drop old table
      db.exec(`DROP TABLE todos;`);

      // 4. Rename new table
      db.exec(`ALTER TABLE todos_new RENAME TO todos;`);

      // 5. Recreate indexes
      db.exec(`CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_todos_type ON todos(type);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_todos_child ON todos(child_name);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(user_id, status);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_todos_source ON todos(source_email_id);`);

      // Record migration
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        16,
        'Update todos type CHECK constraint to include DECIDE type'
      );
    })();

    console.log('Migration 16 completed');
  }

  // Migration 17: Create subscriptions table for tier-based pricing
  if (version < 17) {
    console.log('Running migration 17: Creating subscriptions table for tier-based pricing');

    db.transaction(() => {
      // Create subscriptions table
      db.exec(`
        CREATE TABLE IF NOT EXISTS subscriptions (
          user_id TEXT PRIMARY KEY,
          tier TEXT NOT NULL DEFAULT 'FREE'
            CHECK(tier IN ('FREE', 'ORGANIZED', 'PROFESSIONAL', 'CONCIERGE')),
          status TEXT NOT NULL DEFAULT 'active'
            CHECK(status IN ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused')),
          stripe_customer_id TEXT,
          stripe_subscription_id TEXT,
          current_period_start DATETIME,
          current_period_end DATETIME,
          cancel_at_period_end BOOLEAN DEFAULT 0,
          trial_end DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
        );

        -- Indexes for Stripe lookups
        CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
        CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub ON subscriptions(stripe_subscription_id);
        CREATE INDEX IF NOT EXISTS idx_subscriptions_tier ON subscriptions(tier);
        CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
      `);

      // Backfill existing users with FREE tier
      db.exec(`
        INSERT OR IGNORE INTO subscriptions (user_id, tier, status)
        SELECT user_id, 'FREE', 'active' FROM users;
      `);

      // Record migration
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        17,
        'Create subscriptions table for tier-based pricing with Stripe integration'
      );
    })();

    console.log('Migration 17 completed');
  }

  // Migration 18: Create onboarding_scans table for background inbox scanning
  if (version < 18) {
    console.log('Running migration 18: Creating onboarding_scans table for background processing');

    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS onboarding_scans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending', 'scanning', 'ranking', 'complete', 'failed')),
          result_json TEXT,
          error_message TEXT,
          started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          completed_at DATETIME,
          FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
        );

        -- Index for user lookups
        CREATE INDEX IF NOT EXISTS idx_onboarding_scans_user ON onboarding_scans(user_id);
        CREATE INDEX IF NOT EXISTS idx_onboarding_scans_status ON onboarding_scans(status);
      `);

      // Record migration
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        18,
        'Create onboarding_scans table for background inbox scanning during onboarding'
      );
    })();

    console.log('Migration 18 completed');
  }

  // Migration 19: Add job_type to onboarding_scans for multiple job types
  if (version < 19) {
    console.log('Running migration 19: Adding job_type to onboarding_scans');

    db.transaction(() => {
      // Add job_type column
      db.exec(`ALTER TABLE onboarding_scans ADD COLUMN job_type TEXT DEFAULT 'scan_inbox';`);

      // Update status check constraint to include new statuses
      // SQLite doesn't support ALTER CONSTRAINT, but CHECK was added in initial create
      // We'll just add an index for job_type lookups
      db.exec(`CREATE INDEX IF NOT EXISTS idx_onboarding_scans_job_type ON onboarding_scans(job_type);`);

      // Record migration
      db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
        19,
        'Add job_type column to onboarding_scans for extract-for-training and generate-first-email jobs'
      );
    })();

    console.log('Migration 19 completed');
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
