# Implementation Plan: Email Management & Analysis Improvements

## Overview

Three interconnected tasks to improve email processing:
1. **Task 1**: Email storage in DB with Gmail sync
2. **Task 1.9**: Enhanced AI prompt with inference & web search
3. **Task 2**: Two-pass AI analysis with quality scoring

---

## Task 1: Email Management & Database Storage

### Current State
- Emails fetched directly from Gmail API each time
- Processing happens in-memory
- `processed_emails` table only tracks email IDs
- No persistent storage of email content

### Target State
- Daily cron job fetches unprocessed emails
- Full email content stored in database
- Processing status tracked (processed + analyzed flags)
- Gmail labels synced back (PROCESSED label)
- Dashboard reads from DB instead of Gmail API

### Database Changes

#### New Table: `emails`
```sql
CREATE TABLE emails (
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
  labels TEXT, -- JSON array

  -- Attachment content (extracted and merged)
  has_attachments BOOLEAN DEFAULT 0,
  attachment_content TEXT,

  -- Processing flags
  processed BOOLEAN DEFAULT 0,    -- Successfully stored in DB
  analyzed BOOLEAN DEFAULT 0,     -- AI extraction completed

  -- Gmail sync
  gmail_labeled BOOLEAN DEFAULT 0, -- PROCESSED label applied in Gmail

  -- Error tracking
  fetch_error TEXT,
  fetch_attempts INTEGER DEFAULT 0,

  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_emails_user_id ON emails(user_id);
CREATE INDEX idx_emails_gmail_id ON emails(gmail_message_id);
CREATE INDEX idx_emails_processed ON emails(processed);
CREATE INDEX idx_emails_analyzed ON emails(analyzed);
CREATE INDEX idx_emails_date ON emails(date);
CREATE UNIQUE INDEX idx_emails_unique ON emails(user_id, gmail_message_id);
```

#### Migration Strategy
- Add Migration 3 to `src/db/db.ts`
- Deprecate `processed_emails` table (keep for backward compatibility)
- New `emails` table becomes source of truth

### Implementation Steps

#### Step 1.1: Database Layer
**File**: `src/db/emailDb.ts` (NEW)

Functions needed:
- `createEmail(userId, emailData)` - Store email with processed=false, analyzed=false
- `markEmailProcessed(userId, emailId)` - Set processed=true
- `markEmailAnalyzed(userId, emailId)` - Set analyzed=true
- `markEmailLabeled(userId, emailId)` - Set gmail_labeled=true
- `getUnprocessedEmails(userId)` - Get emails where processed=false
- `getUnanalyzedEmails(userId)` - Get emails where analyzed=false
- `getEmailById(userId, emailId)` - Get single email
- `listEmails(userId, filters)` - List emails with pagination
- `recordFetchError(userId, gmailId, error)` - Track fetch failures

#### Step 1.2: Gmail Label Management
**File**: `src/utils/gmailLabelManager.ts` (NEW)

Functions:
- `ensureProcessedLabel(auth)` - Create "PROCESSED" label if doesn't exist
- `applyProcessedLabel(auth, messageIds[])` - Batch apply label
- `removeProcessedLabel(auth, messageIds[])` - Batch remove label
- `getUnprocessedMessageIds(auth, dateRange)` - Query Gmail for messages without PROCESSED label

Gmail query: `after:{DATE} -in:spam -in:trash -in:sent -label:PROCESSED`

#### Step 1.3: Email Fetch & Store Service
**File**: `src/utils/emailStorageService.ts` (NEW)

Main function: `fetchAndStoreEmails(userId, auth, options)`

Process:
1. Query Gmail for unprocessed emails (no PROCESSED label)
2. For each email:
   - Fetch full message with body
   - Extract attachments and merge into body
   - Store in `emails` table with processed=false
   - If successful: mark processed=true
   - If error: record error, increment fetch_attempts
3. Get all emails where processed=true AND gmail_labeled=false
4. Batch apply PROCESSED label to those emails in Gmail
5. Mark gmail_labeled=true in DB
6. Return stats: fetched, stored, labeled, errors

#### Step 1.4: Daily Cron Job
**File**: `src/plugins/dailySummary.ts` (MODIFY)

Add new cron job:
```typescript
{
  cronTime: '0 0 6 * * *',  // Daily at 6:00 AM UTC
  name: 'daily-email-fetch',
  onTick: async function() {
    // For each user:
    //   1. Fetch unprocessed emails
    //   2. Store in database
    //   3. Apply PROCESSED labels
  }
}
```

Manual trigger: `GET /admin/trigger-email-fetch`

#### Step 1.5: Dashboard Email Viewer
**File**: `src/routes/authRoutes.ts` (MODIFY)

Update existing "Raw Emails Viewer" section:
- Change backend to read from `emails` table instead of Gmail API
- Add filters: processed, analyzed, date range
- Show processing status badges
- Add "Refetch" button for failed emails

**New API endpoint**:
- `GET /admin/emails-from-db` - List emails from database

---

## Task 1.9: Enhanced AI Prompt

### Current Prompt Structure
- Event/todo extraction with confidence scores
- Conservative extraction (explicit info only)
- Child name detection
- 7 todo types (PAY, BUY, PACK, SIGN, FILL, READ, REMIND)

### New Prompt Requirements
1. **Human-Readable Analysis** section:
   - Email summary (purpose, tone, intent)
   - Events with recurring flag
   - Todos with recurring flag + web search for how-to

2. **Structured JSON Output**:
   - Same data in JSON format
   - ISO-8601 dates with time defaults
   - Recurring flags
   - Web search results embedded

### Database Changes

#### Update `events` table
```sql
ALTER TABLE events ADD COLUMN recurring BOOLEAN DEFAULT 0;
ALTER TABLE events ADD COLUMN human_analysis TEXT;
```

#### Update `todos` table
```sql
ALTER TABLE todos ADD COLUMN recurring BOOLEAN DEFAULT 0;
ALTER TABLE todos ADD COLUMN how_to_summary TEXT;
ALTER TABLE todos ADD COLUMN how_to_link TEXT;
```

### Implementation Steps

#### Step 1.9.1: Web Search Integration
**File**: `src/utils/webSearchService.ts` (NEW)

Function: `searchHowTo(query: string): Promise<{ summary: string; link: string }>`

Options:
- Use Google Custom Search API
- Use Bing Search API
- Use SerpAPI
- Use Brave Search API

**Question for user**: Which search API do you have access to / prefer?

#### Step 1.9.2: Update Extraction Schema
**File**: `src/parsers/extractionSchema.ts` (MODIFY)

Add to schema:
```typescript
{
  human_analysis: {
    email_summary: string,
    email_tone: string,
    email_intent: string,
    implicit_context?: string
  },
  events: [{
    ...existing_fields,
    recurring: boolean,
    time_of_day: 'morning' | 'afternoon' | 'evening' | 'specific',
    inferred_date: boolean
  }],
  todos: [{
    ...existing_fields,
    recurring: boolean,
    how_to?: {
      query: string,
      summary: string,
      link: string
    }
  }]
}
```

#### Step 1.9.3: Update Extraction Prompt
**File**: `src/parsers/eventTodoExtractor.ts` (MODIFY)

Merge new prompt with existing:
- Keep existing todo types and child detection
- Add human-readable analysis section
- Add recurring detection logic
- Add time-of-day defaults (9am morning, 12pm afternoon, 5pm evening)
- Add web search for todos requiring how-to

#### Step 1.9.4: Post-Processing for Web Search
After AI extraction, for each todo that needs how-to:
- Identify todos with type=BUY or description contains "how to"
- Run web search for relevant query
- Attach results to todo object
- Store in database

---

## Task 2: Two-Pass AI Analysis with Quality Scoring

### Current State
- Single AI pass for extraction
- No quality scoring
- No review/validation step
- Can't assess AI performance over time

### Target State
- Pass 1: Extract events & todos (existing)
- Pass 2: Review & score extraction (1-10)
- Store both passes with linkage
- Side-by-side viewer for email + analysis

### Database Changes

#### New Table: `email_analyses`
```sql
CREATE TABLE email_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  email_id INTEGER NOT NULL,

  -- Analysis metadata
  analysis_type TEXT NOT NULL, -- 'extraction' or 'review'
  ai_provider TEXT NOT NULL,   -- 'openai' or 'anthropic'
  ai_model TEXT NOT NULL,      -- 'gpt-4o', 'claude-3-5-sonnet'

  -- Pass 1: Extraction
  extraction_json TEXT,        -- JSON of events/todos
  extraction_human_readable TEXT, -- Human-readable analysis

  -- Pass 2: Review & Scoring
  review_json TEXT,            -- JSON of review results
  review_notes TEXT,           -- Human-readable review
  quality_score INTEGER,       -- 1-10

  -- Performance metrics
  tokens_used INTEGER,
  processing_time_ms INTEGER,

  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE
);

CREATE INDEX idx_analyses_email ON email_analyses(email_id);
CREATE INDEX idx_analyses_user ON email_analyses(user_id);
CREATE INDEX idx_analyses_score ON email_analyses(quality_score);
```

#### Update `events` table
```sql
ALTER TABLE events ADD COLUMN email_id INTEGER;
ALTER TABLE events ADD COLUMN analysis_id INTEGER;
ALTER TABLE events ADD FOREIGN KEY (email_id) REFERENCES emails(id);
ALTER TABLE events ADD FOREIGN KEY (analysis_id) REFERENCES email_analyses(id);
```

#### Update `todos` table
```sql
ALTER TABLE todos ADD COLUMN email_id INTEGER;
ALTER TABLE todos ADD COLUMN analysis_id INTEGER;
ALTER TABLE todos ADD FOREIGN KEY (email_id) REFERENCES emails(id);
ALTER TABLE todos ADD FOREIGN KEY (analysis_id) REFERENCES email_analyses(id);
```

### Implementation Steps

#### Step 2.1: Analysis Database Layer
**File**: `src/db/emailAnalysisDb.ts` (NEW)

Functions:
- `createAnalysis(userId, emailId, analysisData)` - Store analysis
- `getAnalysisByEmail(userId, emailId)` - Get all analyses for email
- `getAnalysisById(userId, analysisId)` - Get single analysis
- `getAnalysesWithLowScore(userId, threshold)` - Find poor quality analyses
- `getAverageScoreByDateRange(userId, dateRange)` - Performance metrics

#### Step 2.2: Two-Pass Analysis Service
**File**: `src/parsers/twoPassAnalyzer.ts` (NEW)

Main function: `analyzEmailTwoPass(userId, emailId, emailContent, context)`

**Pass 1: Extraction**
- Use enhanced prompt from Task 1.9
- Extract events, todos, human analysis
- Store in `email_analyses` with analysis_type='extraction'
- Return extraction ID

**Pass 2: Review & Scoring**
Prompt structure:
```
You are a quality reviewer for email extraction.

Original email: {email}
Extraction result: {pass1_result}

Review the extraction for:
1. Accuracy - Are events/dates correct?
2. Completeness - Were all events/todos found?
3. Inference Quality - Are inferences reasonable?
4. Recurring Detection - Correctly identified?
5. How-To Relevance - Are search results helpful?

Provide:
- Score (1-10)
- Review notes (what's good, what's missing)
- Suggested improvements

Return JSON:
{
  score: number,
  review_notes: string,
  accuracy_score: number,
  completeness_score: number,
  inference_score: number,
  recurring_detection_score: number,
  improvements: string[]
}
```

Store in `email_analyses` with analysis_type='review'

#### Step 2.3: Update Event/Todo Creation
**File**: `src/db/eventDb.ts` & `src/db/todoDb.ts` (MODIFY)

Update create functions to accept:
- `email_id` - link back to source email
- `analysis_id` - link to analysis that created it

#### Step 2.4: Daily Analysis Cron Job
**File**: `src/plugins/dailySummary.ts` (MODIFY)

Add new cron job:
```typescript
{
  cronTime: '0 30 6 * * *',  // Daily at 6:30 AM UTC (after email fetch)
  name: 'daily-email-analysis',
  onTick: async function() {
    // For each user:
    //   1. Get unanalyzed emails (analyzed=false)
    //   2. Run two-pass analysis
    //   3. Create events & todos
    //   4. Mark email as analyzed=true
  }
}
```

Manual trigger: `GET /admin/trigger-email-analysis`

#### Step 2.5: Side-by-Side Viewer
**File**: `src/routes/emailAnalysisRoutes.ts` (NEW)

New page: `/email-analysis-viewer`

Layout:
```
┌─────────────────────────────────────────────────────────┐
│ Email Analysis Viewer                                    │
├──────────────────────┬──────────────────────────────────┤
│ Raw Email            │ AI Analysis                       │
│                      │                                   │
│ From: school@...     │ ✅ Quality Score: 8/10            │
│ Subject: PE Kit      │                                   │
│ Date: 2026-01-16     │ Human Analysis:                   │
│                      │ - Purpose: Reminder about PE      │
│ Body:                │ - Tone: Informative               │
│ Please bring PE kit  │ - Intent: Action required         │
│ on Tuesday...        │                                   │
│                      │ Events Found:                     │
│                      │ 📅 PE Class                       │
│                      │    Date: 2026-01-21T09:00:00      │
│                      │    Recurring: Yes (weekly)        │
│                      │                                   │
│                      │ Todos Found:                      │
│                      │ 📦 Pack PE Kit                    │
│                      │    Due: 2026-01-21T09:00:00       │
│                      │    Recurring: Yes                 │
│                      │    How-to: [link]                 │
│                      │                                   │
│                      │ Review Notes:                     │
│                      │ ✓ Correctly identified recurring  │
│                      │ ✗ Could infer morning time        │
└──────────────────────┴──────────────────────────────────┘
```

Features:
- Filter by quality score
- Filter by date range
- Sort by score (lowest first to review poor quality)
- "Reanalyze" button to re-run AI

API Endpoints:
- `GET /api/email-analysis` - List all with filters
- `GET /api/email-analysis/:emailId` - Get specific analysis
- `POST /api/email-analysis/:emailId/reanalyze` - Re-run analysis

---

## Implementation Order & Dependencies

### Phase 1: Database Foundation (Task 1 - Storage)
**Estimated: 4-6 hours**

1. Migration 3: Create `emails` table
2. Create `src/db/emailDb.ts` with CRUD operations
3. Create `src/utils/gmailLabelManager.ts`
4. Create `src/utils/emailStorageService.ts`
5. Add daily-email-fetch cron job
6. Update dashboard to read from DB
7. Test email storage flow

**Deliverable**: Emails stored in DB with Gmail sync

---

### Phase 2: Enhanced Extraction (Task 1.9 - Prompt)
**Estimated: 3-4 hours**

1. Integrate web search API
2. Update extraction schema with recurring flags
3. Update prompt in `eventTodoExtractor.ts`
4. Add time-of-day logic (9am/12pm/5pm defaults)
5. Add post-processing for web search
6. Test new extraction format

**Deliverable**: Enhanced extraction with inference & web search

---

### Phase 3: Quality Analysis (Task 2 - Two-Pass)
**Estimated: 5-7 hours**

1. Migration 4: Create `email_analyses` table
2. Update `events` and `todos` tables with foreign keys
3. Create `src/db/emailAnalysisDb.ts`
4. Create `src/parsers/twoPassAnalyzer.ts`
5. Add review prompt for Pass 2
6. Add daily-email-analysis cron job
7. Create `src/routes/emailAnalysisRoutes.ts`
8. Build side-by-side viewer UI
9. Test full analysis pipeline

**Deliverable**: Two-pass analysis with quality scoring + viewer

---

## Questions for Clarification

### 1. Web Search API
For Task 1.9 (web search for how-to):
- **Which search API do you have access to?**
  - Google Custom Search API
  - Bing Search API
  - SerpAPI
  - Brave Search API
  - Other?
- **Budget constraints for search API calls?**
- **Fallback if search fails?** (skip how-to, use placeholder, etc.)

### 2. Gmail PROCESSED Label
- **Should we create the label automatically** or assume it exists?
- **What should happen if label creation fails?** (skip sync, throw error, etc.)
- **Should we handle label removal** if email is deleted from DB?

### 3. Email Retention
- **How long should we keep emails in the DB?**
  - Forever
  - 90 days
  - 1 year
  - Configurable per user
- **What about analyzed emails?** Keep forever or cleanup?

### 4. Cron Job Timing
- **Email fetch at 6:00 AM UTC** - is this good for your timezone?
- **Analysis at 6:30 AM UTC** - allows 30 min for fetch to complete
- **Should these be configurable** per user?

### 5. Error Handling
- **Max fetch attempts** before giving up on an email?
- **Should we alert user** if too many emails fail?
- **Retry strategy** for failed analyses?

### 6. Quality Score Threshold
- **What score is "acceptable"?** (e.g., 7/10)
- **Should low-score analyses trigger alerts?**
- **Should we auto-retry low-score analyses** with different AI provider?

### 7. AI Provider Strategy
- **Always use OpenAI for both passes?**
- **Use different providers for Pass 1 vs Pass 2?**
- **Fallback strategy if OpenAI fails?**

### 8. Migration Strategy
- **Backfill existing processed emails** into new `emails` table?
- **Or start fresh from implementation date?**
- **Keep old `processed_emails` table** for historical record?

---

## Testing Strategy

### Unit Tests
- `emailDb.ts` - CRUD operations
- `gmailLabelManager.ts` - Label operations
- `emailStorageService.ts` - Fetch & store logic
- `twoPassAnalyzer.ts` - Analysis logic

### Integration Tests
- Full email fetch → store → label → analyze flow
- Error handling (Gmail API failure, AI API failure)
- Cron job execution (manual trigger)

### Manual Testing Checklist
1. Run manual email fetch
2. Verify emails in DB
3. Check PROCESSED labels in Gmail
4. Run manual analysis
5. Check events & todos created
6. Verify analysis scores
7. View side-by-side comparison
8. Test filters and sorting
9. Test reanalyze function
10. Monitor cron job execution

---

## Performance Considerations

### Database
- Indexes on frequently queried fields
- Pagination for email listing (don't load all at once)
- Cleanup old emails to prevent bloat

### API Calls
- Batch Gmail operations (labels, fetches)
- Rate limiting for AI API calls
- Caching for repeated analyses

### Cron Jobs
- Stagger user processing (don't process all users simultaneously)
- Timeout protection (max 5 min per user)
- Logging for monitoring

---

## Rollout Plan

### Day 1-2: Phase 1 (Storage)
- Implement database layer
- Implement Gmail sync
- Test with small dataset

### Day 3-4: Phase 2 (Prompt)
- Update extraction prompt
- Add web search
- Test extraction quality

### Day 5-7: Phase 3 (Analysis)
- Implement two-pass analysis
- Build viewer UI
- End-to-end testing

### Day 8: Monitoring & Refinement
- Monitor cron jobs
- Check quality scores
- Tune prompts based on results
- Fix any bugs

---

## Success Metrics

1. **Email Storage Success Rate**: >95% of emails stored successfully
2. **Gmail Sync Success Rate**: >98% of processed emails labeled
3. **Analysis Quality Score**: Average score >7/10
4. **Processing Time**: <30 seconds per email (including two passes)
5. **User Experience**: Dashboard loads <2 seconds (from DB, not Gmail API)

---

## Open Questions Summary

1. Which web search API?
2. Gmail label creation strategy?
3. Email retention policy?
4. Cron job timing preferences?
5. Error handling thresholds?
6. Quality score expectations?
7. AI provider strategy?
8. Migration/backfill approach?

Please answer these questions so I can finalize the implementation plan!
