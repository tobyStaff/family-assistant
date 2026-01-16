# AI Analysis Pipeline - Complete Summary

## Overview

The inbox-manager system implements two parallel AI analysis pipelines for processing school-related emails. This document provides a comprehensive overview of how the AI analysis currently works.

---

## Two Parallel AI Pipelines

The system runs **two separate AI analysis paths** that work independently:

### Pipeline 1: Event & Todo Extraction
**File**: `src/parsers/eventTodoExtractor.ts`

- **Purpose**: Extract structured calendar events and actionable todos
- **Input**: Raw emails with full body text + attachments
- **AI Model**:
  - Primary: OpenAI GPT-4o (2024-08-06)
  - Fallback: Anthropic Claude 3.5 Sonnet
- **Temperature**: 0.2 (low for consistency)
- **Output**: Structured events and todos with confidence scores

**Schema** (`src/parsers/extractionSchema.ts`):
```typescript
{
  events: [{
    title: string,
    date: string,              // ISO 8601
    end_date?: string,
    description?: string,
    location?: string,
    child_name?: string,
    source_email_id: string,
    confidence: number         // 0.0-1.0
  }],
  todos: [{
    description: string,
    type: 'PAY' | 'BUY' | 'PACK' | 'SIGN' | 'FILL' | 'READ' | 'REMIND',
    due_date?: string,
    child_name?: string,
    source_email_id: string,
    url?: string,
    amount?: string,
    confidence: number
  }],
  emails_analyzed: number
}
```

### Pipeline 2: Inbox Summary Analysis
**File**: `src/parsers/summaryParser.ts`

- **Purpose**: Generate human-readable summaries with signal/noise classification
- **Input**: Emails + context (existing todos, upcoming events)
- **AI Model**:
  - OpenAI GPT-4o with structured outputs
  - Anthropic Claude 3.5 Sonnet
- **Temperature**: 0.7 (higher for contextual understanding)
- **Output**: School summary with financials, kit needs, recurring activities

**Output Schema** (`src/parsers/schoolSummarySchema.ts`):
```typescript
{
  email_analysis: {
    total_received: number,     // Must match input count
    signal_count: number,       // School-related emails
    noise_count: number,        // Non-school emails
    noise_examples: string[]
  },
  summary: [{
    child: string,
    icon: string,
    text: string
  }],
  kit_list: {
    tomorrow: [{item: string, context: string}],
    upcoming: [{item: string, day: string}]
  },
  financials: [{
    description: string,
    amount: string,
    deadline: string,           // ISO 8601 required!
    url?: string,
    payment_method?: string
  }],
  attachments_requiring_review: [{
    subject: string,
    from: string,
    reason: string
  }],
  calendar_updates: [{
    event: string,
    date: string,               // ISO 8601 required!
    action: string
  }],
  recurring_activities: [{
    description: string,
    child: string,
    days_of_week: number[],     // 1-7 (Mon-Sun)
    frequency: string,
    requires_kit: boolean,
    kit_items?: string[]
  }],
  pro_dad_insight: string
}
```

---

## Complete Processing Flow

### Step-by-Step Pipeline

```
1. Fetch emails from Gmail (with body text)
   ↓
2. Extract PDF/DOCX attachments (marked as HIGH PRIORITY)
   ↓
3. Filter already-processed emails (idempotency check)
   ↓
4. Run BOTH AI pipelines:
   ├─ Event/Todo extraction → Events & Todos
   └─ Summary analysis → SchoolSummary
   ↓
5. Save events to database (status: pending)
   ↓
6. Sync events to Google Calendar (automatic retry)
   ↓
7. Create todos in database
   ↓
8. Mark emails as processed
   ↓
9. Return processing result
```

### Orchestration File
**File**: `src/utils/emailProcessor.ts`

The `processEmails()` function orchestrates the complete flow with:
- Dry-run mode (preview without saving)
- Duplicate event detection
- Batch operations for efficiency
- Comprehensive error handling
- Detailed logging at each step
- Fallback between AI providers

**Processing Result**:
```typescript
{
  success: boolean;
  emails_fetched: number;
  emails_processed: number;
  emails_skipped: number;      // Already processed
  events_created: number;
  todos_created: number;
  errors: string[];
  processing_time_ms: number
}
```

---

## Email Fetching & Preparation

### Email Fetching
**File**: `src/utils/inboxFetcher.ts`

- **Entry points**:
  - `fetchRecentEmails()` - metadata only
  - `fetchRecentEmailsWithBody()` - full content
- **Source**: Gmail API v1
- **Query**: `after:{DATE} -in:spam -in:trash`
- **Date ranges**: today, yesterday, last 3/7/30/90 days
- **Extracts**: From, Subject, Date, snippet, labels, body text

**Email Data Structure**:
```typescript
{
  id: string;                    // Gmail message ID
  from: string;                  // Sender email
  fromName: string;              // Sender name
  subject: string;
  snippet: string;               // Preview text
  receivedAt: string;            // ISO 8601
  labels: string[];              // Gmail labels
  hasAttachments: boolean;
  bodyText?: string;             // Full body (optional)
  attachmentContent?: string;    // Extracted attachment text
}
```

### Attachment Extraction
**File**: `src/utils/attachmentExtractor.ts`

**Supported formats**:
- PDF (via PDF.js)
- DOCX/DOC (via Mammoth library)
- Plain text files
- HTML (tag removal)
- CSV

**Processing**:
1. Identifies extractable attachments from email payload
2. Filters by size (max 5MB) and mime type
3. Downloads attachment via Gmail API
4. Extracts text from file
5. Wraps with marker: `=== IMPORTANT: ATTACHMENT CONTENT BELOW ===`
6. Includes guidance for AI (dates → calendar, payments → financials)

**Key feature**: Attachments marked as HIGH PRIORITY for AI extraction

### Email Preprocessing
**File**: `src/utils/emailPreprocessor.ts`

The `prepareEmailsForAI()` function:
1. Sanitizes emails (truncate snippets to 200 chars)
2. Gathers context:
   - Upcoming TODOs (pending, due within 7 days)
   - Upcoming calendar events (next 7 days)
   - Current date
3. Returns enriched `InboxAnalysisInput` with emails + context

This context helps AI make informed decisions and avoid duplicates.

---

## What Gets Extracted

### Events
- **Title**: Event name
- **Date/Time**: ISO 8601 format
- **End Date**: Optional
- **Location**: Venue/address
- **Description**: Additional details
- **Child Name**: Specific child or "General"
- **Confidence**: 0.0-1.0 score
- **Source Email ID**: For tracking

### Todos (7 Types)

1. **PAY**: Payment required
   - Amount, URL, deadline
2. **BUY**: Purchase needed
   - Item, deadline
3. **PACK**: Items to pack
   - Kit list, deadline
4. **SIGN**: Document signing
   - Document name, deadline
5. **FILL**: Form completion
   - Form name, deadline
6. **READ**: Information to review
   - Document, no deadline
7. **REMIND**: General reminder
   - Context, optional deadline

**Common fields**:
- Description
- Due date (optional)
- Child name
- Confidence score
- Source email ID

### Summary Analysis Outputs

**Signal vs Noise Classification**:
- **SIGNAL**: School schedules, events, logistics, payments, academics
- **NOISE**: General newsletters, marketing, non-actionable content
- School attachments always = SIGNAL

**Kit List**:
- **Tomorrow**: Urgent items needed next day
- **Upcoming**: Items needed later this week

**Financials**:
- Description, amount, deadline (ISO 8601 required)
- Payment URL and method
- Only included if deadline is valid

**Recurring Activities**:
- Pattern detection (e.g., "PE every Monday")
- Days of week (1-7 for Mon-Sun)
- Kit requirements
- Frequency description

**Attachments Requiring Review**:
- Subject, from, reason for review
- Highlights important documents

**Pro Dad Insight**:
- Contextual summary or helpful tip
- Written in friendly, parent-oriented tone

---

## AI Provider Comparison

| Aspect | OpenAI (GPT-4o) | Anthropic (Claude 3.5) |
|--------|-----------------|------------------------|
| **Structured Outputs** | ✅ Yes (guaranteed JSON) | ❌ No (manual cleanup) |
| **Event Extraction** | ✅ Primary | Fallback only |
| **Summary Analysis** | ✅ Available | ✅ Available |
| **Temperature** | 0.2 (events), 0.7 (summary) | Same |
| **Max Tokens** | Default | 4000 (events), 2500 (summary) |
| **Fallback Chain** | → Anthropic if fails | None (is the fallback) |
| **JSON Reliability** | Perfect (schema enforced) | Requires cleanup |

---

## Prompt Engineering Strategies

### Event/Todo Extraction Prompt
**Length**: ~550 lines of instructions

**Key sections**:
1. Task definition (extract events + todos)
2. Critical rules (only explicit info, confidence scoring)
3. Classification rules (7 todo types with examples)
4. Child name extraction rules
5. Attachment processing guidance
6. Example extractions (good & bad)

**Emphasis**:
- Conservative extraction (no assumptions)
- Honest confidence scores
- Only explicit dates and information

### Summary Analysis Prompt
**Length**: ~300 lines of instructions

**Key sections**:
1. Role: Executive Assistant for parents
2. Critical rules (email count validation, signal/noise)
3. Reasoning steps (chain-of-thought)
4. Attachment handling (highest priority)
5. Recurring pattern detection
6. Output format requirements
7. Strict rules (no invented data, ISO8601 dates)
8. Good vs bad output examples

**Emphasis**:
- Signal classification accuracy
- Attachment extraction as main content
- Recurring pattern detection
- No hallucinations

---

## Key Features & Safeguards

### 1. Idempotency
- Emails marked as processed are never re-analyzed
- Uses `processed_emails` table to track
- Prevents duplicate events and todos

### 2. Confidence Scoring
- Every extraction rated 0.0-1.0
- Low confidence items can be filtered
- Helps users prioritize review

### 3. Conservative Extraction
- No inferences or assumptions
- Only explicit information from emails
- "I don't know" is better than guessing

### 4. Attachment Priority
- Text extracted from PDF/DOCX
- Marked sections guide AI
- Treated as main content (not secondary)

### 5. Signal/Noise Classification
- School emails always classified as SIGNAL
- Helps filter relevant information
- Noise examples shown for transparency

### 6. Date Validation
- ISO 8601 required for all dates/deadlines
- Invalid dates → item excluded from output
- Prevents calendar sync errors

### 7. Provider Fallback
- Automatic retry with Anthropic if OpenAI fails
- Comprehensive error logging
- System remains operational if one provider is down

### 8. Error Handling
- Try/catch at every level
- Meaningful error messages
- Graceful degradation (continue processing other emails)

### 9. Batch Processing
- Database operations wrapped in transactions
- Efficient bulk inserts
- Atomic operations (all-or-nothing)

### 10. Dry-run Mode
- Preview extractions without writing to database
- Test AI changes safely
- Validate results before committing

---

## Data Flow Diagram

```
Gmail API
    ↓
[inboxFetcher] Fetch emails with metadata & body
    ↓
[attachmentExtractor] Extract PDF/DOCX text if present
    ↓
EmailMetadata[] {id, from, subject, bodyText, attachmentContent}
    ↓
    ├─→ [emailPreprocessor] Prepare context
    │       ↓
    │   Add upcoming TODOs & events
    │       ↓
    │   InboxAnalysisInput
    │       ↓
    │   [summaryParser.analyzeInbox()]
    │       ↓
    │   SchoolSummary (signal/noise, kit needs, financials, etc.)
    │
    └─→ [eventTodoExtractor]
            ↓
        Extract events & todos with AI
            ↓
        ExtractionResult {events[], todos[]}
            ↓
        [emailProcessor.processEmails()]
            ├─→ Save events to eventDb (status: pending)
            ├─→ Sync to Google Calendar (automatic retry)
            ├─→ Create todos in todoDb
            └─→ Mark emails as processed
```

---

## Example Extractions

### Event Extraction Example

**Input Email**:
```
From: school@example.com
Subject: School Trip - Natural History Museum

Dear Parents,

Year 5 will be visiting the Natural History Museum on Friday 17th January.
Cost is £15 per child. Please pay via ParentPay by Wednesday 15th January.

Coach departs at 9am, returns at 3pm.

Regards,
Mrs. Smith
```

**Output Events**:
```json
[{
  "title": "School trip to Natural History Museum",
  "date": "2026-01-17T09:00:00Z",
  "end_date": "2026-01-17T15:00:00Z",
  "location": "Natural History Museum",
  "description": "Year 5 school trip",
  "child_name": "General",
  "source_email_id": "msg_123",
  "confidence": 0.95
}]
```

**Output Todos**:
```json
[{
  "description": "Pay £15 for Natural History Museum trip",
  "type": "PAY",
  "due_date": "2026-01-15T23:59:59Z",
  "amount": "£15.00",
  "url": "https://www.parentpay.com/...",
  "child_name": "General",
  "source_email_id": "msg_123",
  "confidence": 0.95
}]
```

### Summary Analysis Example

**Input**: 5 emails
- PE schedule from school
- Payment request with attachment
- General newsletter
- Marketing email
- Calendar update

**Output**:
```json
{
  "email_analysis": {
    "total_received": 5,
    "signal_count": 3,
    "noise_count": 2,
    "noise_examples": ["Marketing email from uniform shop", "General community newsletter"]
  },
  "summary": [{
    "child": "General",
    "icon": "🏛️",
    "text": "Science Museum trip Jan 20th - payment & consent form due by Friday"
  }],
  "financials": [{
    "description": "School trip to Science Museum",
    "amount": "£12.50",
    "deadline": "2026-01-17T00:00:00Z",
    "payment_method": "Arbor Pay",
    "url": "https://arbor.school/pay/123"
  }],
  "kit_list": {
    "tomorrow": [{
      "item": "PE kit",
      "context": "Tuesday is PE day"
    }],
    "upcoming": []
  },
  "recurring_activities": [{
    "description": "PE lesson",
    "child": "General",
    "days_of_week": [2],
    "frequency": "Weekly",
    "requires_kit": true,
    "kit_items": ["PE kit", "Trainers"]
  }],
  "attachments_requiring_review": [{
    "subject": "Science Museum Trip - Consent Form",
    "from": "school@example.com",
    "reason": "Consent form attached requiring signature by Friday"
  }],
  "calendar_updates": [{
    "event": "Science Museum Trip",
    "date": "2026-01-20T00:00:00Z",
    "action": "add"
  }],
  "pro_dad_insight": "Don't forget Tuesday is PE day - make sure kit is washed and ready!"
}
```

---

## Current Limitations

### 1. Anthropic Structured Outputs
**Issue**: Summary parser doesn't have structured outputs for Anthropic
- Requires manual JSON cleanup
- Less reliable than OpenAI
- May fail if JSON is malformed

**Impact**: Increased error rate when using Anthropic for summaries

### 2. Attachment Format Support
**Issue**: Limited to text-based formats
- No OCR for images/scanned documents
- No table extraction from complex PDFs
- HTML tables lose structure

**Impact**: Information in images/scans is missed

### 3. File Size Limits
**Issue**: Large PDFs (>5MB) are skipped
- Avoids token/memory issues
- May miss important content

**Impact**: Some comprehensive documents not analyzed

### 4. Child Name Inference
**Issue**: Relies on explicit mentions
- "Year 5" doesn't map to specific child
- "Your daughter" is ambiguous

**Impact**: Many events/todos marked as "General" instead of child-specific

### 5. Recurring Pattern Detection
**Issue**: Only detects weekly frequency
- No monthly patterns (e.g., "first Monday of month")
- No yearly patterns (e.g., "annual sports day")

**Impact**: Some recurring events not identified

### 6. Date Parsing
**Issue**: No natural language date parsing
- Requires explicit dates like "Jan 20th"
- "Next Tuesday" not understood
- Relative dates ("in 2 weeks") not parsed

**Impact**: Some events/todos miss deadline extraction

### 7. Multi-Child Scenarios
**Issue**: Email mentions multiple children
- Extracts as single item with first child mentioned
- Should create separate items per child

**Impact**: Parent may miss that event applies to multiple children

### 8. Context Window Limits
**Issue**: Very long email threads may be truncated
- GPT-4o has context limit
- Older messages in thread may be lost

**Impact**: Missing context from earlier emails in conversation

---

## Storage Architecture

### Events Storage
**Table**: `events` (SQLite)

**Columns**:
- Event data: title, date, end_date, description, location
- Metadata: child_name, source_email_id, confidence
- Sync tracking: sync_status (pending/synced/failed), google_calendar_event_id
- Retry logic: last_sync_attempt, sync_error, retry_count
- Timestamps: created_at, updated_at, synced_at

**Sync Flow**:
1. Event saved to DB with status='pending'
2. Attempt sync to Google Calendar
3. If success: status='synced', google_calendar_event_id set
4. If failure: status='failed', retry_count incremented
5. Cron job retries failed events every 15 minutes
6. Max 5 retries with exponential backoff

### Todos Storage
**Table**: `todos` (SQLite)

**Columns**:
- Todo data: description, type, due_date, status
- Metadata: child_name, source_email_id, url, amount
- Timestamps: created_at, completed_at

**Status Flow**:
- Created with status='pending'
- Can be marked as 'done'
- No deletion (soft delete by marking done)

### Processed Emails Tracking
**Table**: `processed_emails` (SQLite)

**Purpose**: Prevent re-processing
- Stores user_id + email_id
- Checked before every processing run
- Ensures idempotency

---

## Configuration & Environment

### Required Environment Variables

```bash
# Google OAuth
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback

# AI Providers
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Encryption
ENCRYPTION_SECRET=32_character_secret_key

# Optional
AI_PROVIDER=openai  # or anthropic
LOG_LEVEL=info
```

### AI Provider Selection

**Default**: OpenAI GPT-4o
**Fallback**: Automatic to Anthropic if OpenAI fails
**Override**: Set `aiProvider` parameter in API calls

---

## Performance Characteristics

### Typical Processing Times
- **Fetch 50 emails**: ~2-5 seconds (depends on attachment count)
- **Extract attachments**: ~1-3 seconds per PDF/DOCX
- **AI extraction**: ~5-15 seconds (depends on email count and length)
- **Database writes**: <100ms
- **Calendar sync**: ~500ms per event
- **Total for 50 emails**: ~30-60 seconds

### Token Usage (Approximate)
- **Event extraction**: ~1,000-3,000 tokens per email
- **Summary analysis**: ~500-2,000 tokens per email
- **With attachments**: Can increase 5-10x

### Rate Limits
- **OpenAI**: 10,000 TPM (tokens per minute) on tier 1
- **Anthropic**: 50,000 TPM on tier 1
- **Gmail API**: 250 quota units per user per second

---

## Testing & Debugging

### Dry-run Mode
```typescript
await processEmails(userId, auth, {
  dateRange: 'last3days',
  maxResults: 10,
  aiProvider: 'openai',
  dryRun: true  // Preview without saving
});
```

### Logging
- Comprehensive logging at each pipeline step
- Log levels: debug, info, warn, error
- Structured logging with context (userId, emailId, etc.)

### Manual Testing Routes
- `/admin/test-fetch-emails` - Fetch and preview
- `/admin/raw-emails` - View raw emails
- `/admin/process-emails/dry-run` - Preview extraction
- `/admin/process-emails` - Full processing

---

## Future Enhancement Opportunities

### High Priority
1. Add OCR for image attachments (Tesseract.js)
2. Implement natural language date parsing
3. Add Anthropic structured outputs for summary
4. Multi-child extraction (duplicate items per child)

### Medium Priority
5. Monthly/yearly recurring pattern detection
6. Table extraction from PDFs (Tabula)
7. Email thread context preservation
8. Child name inference from "Year 5" mentions

### Low Priority
9. Confidence threshold filtering in UI
10. A/B testing between AI providers
11. Custom extraction rules per user
12. Historical accuracy tracking

---

## Related Files

### Core Pipeline Files
- `src/utils/emailProcessor.ts` - Main orchestrator
- `src/parsers/eventTodoExtractor.ts` - Event/todo extraction
- `src/parsers/summaryParser.ts` - Summary generation
- `src/utils/inboxFetcher.ts` - Gmail fetching
- `src/utils/attachmentExtractor.ts` - Attachment processing
- `src/utils/emailPreprocessor.ts` - Context gathering

### Schema & Types
- `src/parsers/extractionSchema.ts` - Event/todo schema
- `src/parsers/schoolSummarySchema.ts` - Summary schema
- `src/types/extraction.ts` - TypeScript types
- `src/types/summary.ts` - Summary types

### Storage
- `src/db/eventDb.ts` - Event CRUD
- `src/db/todoDb.ts` - Todo CRUD
- `src/db/processedEmailsDb.ts` - Idempotency tracking
- `src/utils/calendarIntegration.ts` - Google Calendar sync

### Routes
- `src/routes/processingRoutes.ts` - Processing endpoints
- `src/routes/eventRoutes.ts` - Event management
- `src/routes/todoRoutes.ts` - Todo management
- `src/routes/adminRoutes.ts` - Testing endpoints

---

**Last Updated**: 2026-01-16
**Document Version**: 1.0
