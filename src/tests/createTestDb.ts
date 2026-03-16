// src/tests/createTestDb.ts
//
// Creates an in-memory SQLite database with the full production schema.
// Use this in vi.mock factory functions to avoid schema drift between
// tests and migrations.
//
// Usage in test files:
//   import Database from 'better-sqlite3';
//   vi.mock('./db.js', () => {
//     const { createTestDb } = require('../tests/createTestDb');
//     return { default: createTestDb() };
//   });

import Database from 'better-sqlite3';

export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');

  db.exec(`
    -- =====================
    -- Core tables
    -- =====================

    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      picture_url TEXT,
      roles TEXT DEFAULT '["STANDARD"]',
      hosted_email_alias TEXT,
      onboarding_step INTEGER DEFAULT 0,
      gmail_connected BOOLEAN DEFAULT 0,
      calendar_connected BOOLEAN DEFAULT 0,
      gmail_forwarding_confirmation_url TEXT DEFAULT NULL,
      trial_started_at TEXT DEFAULT NULL,
      email_suppressed INTEGER DEFAULT 0,
      email_suppressed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS auth (
      user_id TEXT PRIMARY KEY,
      refresh_token TEXT,
      access_token TEXT,
      expiry_date INTEGER
    );

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      summary_email_recipients TEXT,
      summary_enabled BOOLEAN DEFAULT 1,
      summary_time_utc INTEGER DEFAULT 8,
      timezone TEXT DEFAULT 'UTC',
      email_source TEXT DEFAULT 'gmail' CHECK(email_source IN ('gmail', 'hosted')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS processed_emails (
      email_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_processed_user_id ON processed_emails(user_id);

    -- =====================
    -- Todos
    -- =====================

    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      description TEXT NOT NULL,
      due_date DATETIME,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'done')),
      type TEXT DEFAULT 'REMIND' CHECK(type IN ('PAY', 'BUY', 'PACK', 'SIGN', 'FILL', 'READ', 'DECIDE', 'REMIND')),
      child_name TEXT,
      source_email_id TEXT,
      url TEXT,
      amount TEXT,
      confidence REAL,
      completed_at DATETIME,
      auto_completed INTEGER DEFAULT 0,
      recurring BOOLEAN DEFAULT 0,
      recurrence_pattern TEXT,
      responsible_party TEXT,
      inferred BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);
    CREATE INDEX IF NOT EXISTS idx_todos_type ON todos(type);
    CREATE INDEX IF NOT EXISTS idx_todos_child ON todos(child_name);
    CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);
    CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(user_id, status);

    -- =====================
    -- Events
    -- =====================

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      end_date TEXT,
      description TEXT,
      location TEXT,
      child_name TEXT,
      source_email_id TEXT,
      confidence REAL,
      sync_status TEXT NOT NULL DEFAULT 'pending' CHECK(sync_status IN ('pending', 'synced', 'failed')),
      google_calendar_event_id TEXT,
      last_sync_attempt DATETIME,
      sync_error TEXT,
      retry_count INTEGER DEFAULT 0,
      recurring BOOLEAN DEFAULT 0,
      recurrence_pattern TEXT,
      time_of_day TEXT,
      inferred_date BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      synced_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);
    CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
    CREATE INDEX IF NOT EXISTS idx_events_sync_status ON events(sync_status);

    -- =====================
    -- Emails
    -- =====================

    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      gmail_message_id TEXT NOT NULL,
      gmail_thread_id TEXT,
      from_email TEXT NOT NULL,
      from_name TEXT,
      subject TEXT NOT NULL,
      date DATETIME NOT NULL,
      body_text TEXT,
      snippet TEXT,
      labels TEXT,
      has_attachments BOOLEAN DEFAULT 0,
      attachment_content TEXT,
      attachment_extraction_failed BOOLEAN DEFAULT 0,
      attachments_stored BOOLEAN DEFAULT 0,
      processed BOOLEAN DEFAULT 0,
      analyzed BOOLEAN DEFAULT 0,
      gmail_labeled BOOLEAN DEFAULT 0,
      fetch_error TEXT,
      fetch_attempts INTEGER DEFAULT 0,
      source_type TEXT DEFAULT 'gmail' CHECK(source_type IN ('gmail', 'hosted')),
      source_message_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_emails_user_id ON emails(user_id);
    CREATE INDEX IF NOT EXISTS idx_emails_gmail_id ON emails(gmail_message_id);
    CREATE INDEX IF NOT EXISTS idx_emails_processed ON emails(processed);
    CREATE INDEX IF NOT EXISTS idx_emails_analyzed ON emails(analyzed);
    CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_emails_unique ON emails(user_id, gmail_message_id);

    CREATE TABLE IF NOT EXISTS email_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      email_id INTEGER NOT NULL,
      analysis_version INTEGER DEFAULT 1,
      ai_provider TEXT NOT NULL,
      email_summary TEXT,
      email_tone TEXT,
      email_intent TEXT,
      implicit_context TEXT,
      raw_extraction_json TEXT,
      quality_score REAL,
      confidence_avg REAL,
      events_extracted INTEGER DEFAULT 0,
      todos_extracted INTEGER DEFAULT 0,
      recurring_items INTEGER DEFAULT 0,
      inferred_items INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'analyzed', 'reviewed', 'approved', 'rejected')),
      reviewed_by TEXT,
      reviewed_at DATETIME,
      review_notes TEXT,
      analysis_error TEXT,
      retry_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_email_analyses_user_id ON email_analyses(user_id);
    CREATE INDEX IF NOT EXISTS idx_email_analyses_email_id ON email_analyses(email_id);
    CREATE INDEX IF NOT EXISTS idx_email_analyses_status ON email_analyses(status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_email_analyses_unique ON email_analyses(email_id, analysis_version);

    CREATE TABLE IF NOT EXISTS email_action_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      action_type TEXT NOT NULL CHECK(action_type IN ('complete_todo', 'remove_event')),
      target_id INTEGER NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_action_tokens_token ON email_action_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_action_tokens_expires ON email_action_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_action_tokens_user ON email_action_tokens(user_id);

    CREATE TABLE IF NOT EXISTS email_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      storage_path TEXT NOT NULL,
      extraction_status TEXT DEFAULT 'pending'
        CHECK(extraction_status IN ('pending', 'success', 'failed', 'skipped')),
      extraction_error TEXT,
      extracted_text TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_email_attachments_email_id ON email_attachments(email_id);
    CREATE INDEX IF NOT EXISTS idx_email_attachments_status ON email_attachments(extraction_status);

    CREATE TABLE IF NOT EXISTS email_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      summary_date DATE NOT NULL,
      inbox_count INTEGER,
      summary_json TEXT,
      sent_at DATETIME,
      UNIQUE(user_id, summary_date)
    );
    CREATE INDEX IF NOT EXISTS idx_email_summaries_user_id ON email_summaries(user_id);
    CREATE INDEX IF NOT EXISTS idx_email_summaries_date ON email_summaries(summary_date);

    -- =====================
    -- Child & Activity tables
    -- =====================

    CREATE TABLE IF NOT EXISTS child_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      real_name TEXT NOT NULL,
      display_name TEXT,
      year_group TEXT,
      school_name TEXT,
      class_name TEXT,
      clubs TEXT DEFAULT '[]',
      is_active BOOLEAN DEFAULT 1,
      onboarding_completed BOOLEAN DEFAULT 0,
      confidence_score REAL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_child_profiles_user ON child_profiles(user_id);
    CREATE INDEX IF NOT EXISTS idx_child_profiles_active ON child_profiles(is_active);

    CREATE TABLE IF NOT EXISTS recurring_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      description TEXT NOT NULL,
      child TEXT NOT NULL,
      days_of_week TEXT NOT NULL,
      frequency TEXT NOT NULL,
      requires_kit BOOLEAN NOT NULL,
      kit_items TEXT NOT NULL DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_recurring_user ON recurring_activities(user_id);
    CREATE INDEX IF NOT EXISTS idx_recurring_child ON recurring_activities(child);

    -- =====================
    -- Filtering & Feedback
    -- =====================

    CREATE TABLE IF NOT EXISTS sender_filters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      sender_email TEXT NOT NULL,
      sender_name TEXT,
      status TEXT NOT NULL CHECK(status IN ('include', 'exclude')),
      relevance_score REAL,
      relevant_count INTEGER DEFAULT 0,
      not_relevant_count INTEGER DEFAULT 0,
      last_score_update DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, sender_email)
    );
    CREATE INDEX IF NOT EXISTS idx_sender_filters_user ON sender_filters(user_id);
    CREATE INDEX IF NOT EXISTS idx_sender_filters_status ON sender_filters(user_id, status);

    CREATE TABLE IF NOT EXISTS relevance_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      item_type TEXT NOT NULL CHECK(item_type IN ('todo', 'event')),
      item_text TEXT NOT NULL,
      source_sender TEXT,
      source_subject TEXT,
      is_relevant INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_relevance_feedback_user ON relevance_feedback(user_id);

    -- =====================
    -- Subscriptions & Billing
    -- =====================

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
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub ON subscriptions(stripe_subscription_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_tier ON subscriptions(tier);

    -- =====================
    -- Onboarding
    -- =====================

    CREATE TABLE IF NOT EXISTS onboarding_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'scanning', 'ranking', 'complete', 'failed')),
      result_json TEXT,
      error_message TEXT,
      job_type TEXT DEFAULT 'scan_inbox',
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_onboarding_scans_user ON onboarding_scans(user_id);
    CREATE INDEX IF NOT EXISTS idx_onboarding_scans_status ON onboarding_scans(status);

    CREATE TABLE IF NOT EXISTS onboarding_emails_sent (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      day INTEGER NOT NULL,
      email_type TEXT NOT NULL,
      sent_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, day, email_type)
    );
    CREATE INDEX IF NOT EXISTS idx_onboarding_emails_user ON onboarding_emails_sent(user_id);

    -- =====================
    -- Metrics
    -- =====================

    CREATE TABLE IF NOT EXISTS ai_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      provider TEXT NOT NULL,
      emails_total INTEGER NOT NULL,
      emails_signal INTEGER NOT NULL,
      emails_noise INTEGER NOT NULL,
      attachments_total INTEGER,
      attachments_extracted INTEGER,
      attachments_failed INTEGER,
      validation_passed BOOLEAN NOT NULL,
      validation_errors TEXT,
      response_time_ms INTEGER,
      financials_count INTEGER,
      calendar_updates_count INTEGER,
      attachments_review_count INTEGER,
      kit_tomorrow_count INTEGER,
      schema_validated BOOLEAN DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_ai_metrics_user_id ON ai_metrics(user_id);
    CREATE INDEX IF NOT EXISTS idx_ai_metrics_timestamp ON ai_metrics(timestamp);
  `);

  return db;
}
