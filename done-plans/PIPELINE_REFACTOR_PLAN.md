# Email Processing Pipeline Refactor - Implementation Plan

**Status**: Planning Phase
**Date**: 2026-01-12
**Goal**: Restructure email processing into distinct, composable steps for better modularity and personalization

---

## Executive Summary

This plan restructures the email processing pipeline from a monolithic AI analysis approach into four distinct steps:

1. **Email & Attachment Fetching** - Retrieve emails and extract attachment content
2. **AI Extraction** - Extract Events and Action Items (Todos) with AI
3. **Database Storage** - Store Events in Calendar, Todos in database with types
4. **Personalized Summary** - Build email briefing using stored data + child profiles

**Benefits:**
- **Separation of Concerns**: Each step has a clear responsibility
- **Reusability**: Events and todos can be used by multiple features
- **Testability**: Each step can be tested independently
- **Personalization**: Final summary uses structured data + user context

---

## Current Architecture Analysis

### Current Flow:
```
User Trigger
    ↓
Fetch Emails + Attachments (inboxFetcher.ts)
    ↓
AI Analysis (summaryParser.ts)
    ↓
Generate HTML Email (emailRenderer.ts)
    ↓
Send Email (Gmail API)
```

### Problems:
1. **Monolithic AI Analysis**: One large prompt tries to do everything
2. **No Structured Storage**: Events and todos are extracted but not persisted
3. **No Reusability**: Extracted data is only used for summary email
4. **Token Waste**: Re-analyzing same emails for different features
5. **Limited Personalization**: Child profiles exist but aren't used in summaries

---

## Proposed New Architecture

### New Flow:
```
User Trigger / Cron Job
    ↓
Step 1: Email & Attachment Fetching
    ├─ Fetch emails from Gmail API (last N days)
    ├─ Extract PDF/DOCX content
    └─ Store in: processed_emails table (existing)
    ↓
Step 2: AI Extraction (Event & Todo Detector)
    ├─ Analyze emails for KEY EVENTS (with dates)
    ├─ Analyze emails for ACTION ITEMS (todos with types)
    └─ Output: Structured JSON
    ↓
Step 3: Database Storage
    ├─ Events → Google Calendar (with 7pm reminder day before)
    ├─ Todos → todos table (with type: PAY, BUY, PACK, etc.)
    └─ Both linked to source email (email_id foreign key)
    ↓
Step 4: Personalized Summary Builder
    ├─ Fetch: Calendar Events (next 7 days)
    ├─ Fetch: Pending Todos (all)
    ├─ Fetch: Child Profiles (active)
    ├─ AI Analysis: School-specific insights using structured data
    └─ Generate & Send: HTML email briefing
```

### Key Changes:
1. **Two-Stage AI**: Event/Todo extraction (Step 2) + Personalized analysis (Step 4)
2. **Persistent Storage**: Events and todos are stored, not ephemeral
3. **Context-Aware**: Final summary uses child profiles for personalization
4. **Source Tracking**: Todos and events linked to source emails

---

## Step 1: Email & Attachment Fetching

**Status**: ✅ Already Implemented

**Files:**
- `src/utils/inboxFetcher.ts` - Fetches emails
- `src/utils/attachmentExtractor.ts` - Extracts PDF/DOCX content
- `src/db/processedEmailsDb.ts` - Stores processed email metadata

**No Changes Needed**: This step is already working correctly.

---

## Step 2: AI Extraction - Events & Todos

**Goal**: Extract structured events and action items from emails using AI.

### New TypeScript Types

**File**: `src/types/extraction.ts` (NEW)

```typescript
/**
 * Action item type categories
 */
export type TodoType =
  | 'PAY'      // Payment required (e.g., trip fee, lunch money)
  | 'BUY'      // Purchase item (e.g., uniform, supplies)
  | 'PACK'     // Pack item for school (e.g., PE kit, costume)
  | 'SIGN'     // Sign document/form
  | 'FILL'     // Fill out form/questionnaire
  | 'READ'     // Read attachment/document
  | 'REMIND';  // General reminder (default)

/**
 * Extracted event from emails
 */
export interface ExtractedEvent {
  title: string;              // Event name (e.g., "Inset Day - No School")
  date: string;               // ISO8601 date (e.g., "2026-01-20T09:00:00Z")
  end_date?: string;          // Optional end date for multi-day events
  description?: string;       // Additional context
  location?: string;          // Event location if mentioned
  child_name?: string;        // Associated child (null = General)
  source_email_id?: string;   // Email ID from processed_emails table
  confidence: number;         // 0.0-1.0 confidence score
}

/**
 * Extracted action item (todo) from emails
 */
export interface ExtractedTodo {
  description: string;        // What needs to be done
  type: TodoType;             // Category of action
  due_date?: string;          // ISO8601 date (null if no deadline)
  child_name?: string;        // Associated child (null = General)
  source_email_id?: string;   // Email ID from processed_emails table
  url?: string;               // Payment link or relevant URL
  amount?: string;            // Amount if type=PAY (e.g., "£15.00")
  confidence: number;         // 0.0-1.0 confidence score
}

/**
 * Result from AI extraction
 */
export interface ExtractionResult {
  events: ExtractedEvent[];
  todos: ExtractedTodo[];
  emails_analyzed: number;
  extraction_timestamp: string;
}
```

### New AI Extraction Function

**File**: `src/parsers/eventTodoExtractor.ts` (NEW)

```typescript
/**
 * Extract events and todos from emails using AI
 *
 * @param emails - Array of email metadata with content
 * @param provider - AI provider ('openai' | 'anthropic')
 * @returns Extracted events and todos
 */
export async function extractEventsAndTodos(
  emails: EmailMetadata[],
  provider: 'openai' | 'anthropic' = 'openai'
): Promise<ExtractionResult>;
```

### AI Prompt Strategy

**Prompt Focus**: Extract structured events and action items ONLY.

**Example Prompt Excerpt**:
```
You are an AI assistant that extracts key information from school-related emails.

Your task is to identify:
1. **KEY EVENTS** - Important dates and events (e.g., trips, inset days, performances)
2. **ACTION ITEMS** - Things that require parent action (todos)

For each EVENT, extract:
- title: Event name
- date: ISO8601 datetime
- child_name: Which child (or null for general)
- confidence: 0.0-1.0

For each TODO, extract:
- description: What needs to be done
- type: PAY | BUY | PACK | SIGN | FILL | READ | REMIND
- due_date: ISO8601 datetime (null if no deadline)
- child_name: Which child (or null)
- url: Payment link if type=PAY
- amount: Amount if type=PAY
- confidence: 0.0-1.0

Rules:
- Only extract EXPLICIT events and actions
- Do not infer or assume information
- Set confidence based on clarity of information
- For recurring activities (PE days), extract as PACK todo with recurring flag

Output JSON with:
{
  "events": [...],
  "todos": [...],
  "emails_analyzed": number
}
```

**OpenAI JSON Schema**: Use Structured Outputs with strict schema validation.

---

## Step 3: Database Storage

### 3.1 Update Todos Table Schema

**File**: `src/db/db.ts`

**Current Schema**:
```sql
CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  description TEXT NOT NULL,
  due_date DATETIME,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'done')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**New Schema**:
```sql
CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('PAY', 'BUY', 'PACK', 'SIGN', 'FILL', 'READ', 'REMIND')),
  due_date DATETIME,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'done')),
  child_name TEXT,                  -- NEW: Which child (null = General)
  source_email_id TEXT,             -- NEW: Link to processed_emails.id
  url TEXT,                         -- NEW: Payment link or relevant URL
  amount TEXT,                      -- NEW: Amount for PAY type
  confidence REAL,                  -- NEW: AI confidence (0.0-1.0)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,            -- NEW: When marked done
  FOREIGN KEY (source_email_id) REFERENCES processed_emails(id) ON DELETE SET NULL
);

-- New indexes
CREATE INDEX IF NOT EXISTS idx_todos_type ON todos(type);
CREATE INDEX IF NOT EXISTS idx_todos_child ON todos(child_name);
CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);
```

**Migration Strategy**: Add new columns as nullable, then populate from existing data.

### 3.2 Create Events Table (Optional)

**Alternative**: Store events directly in Google Calendar, no local table needed.

**Pros of Calendar-only**:
- Single source of truth
- Users can edit events in Google Calendar
- No sync issues

**Cons**:
- Harder to query for summary generation
- Network dependency

**Recommendation**: Store events in Google Calendar only. For summary generation, fetch from Calendar API.

### 3.3 Database API Updates

**File**: `src/db/todoDb.ts` (UPDATE)

**New Functions**:
```typescript
/**
 * Create todo from AI extraction
 */
export function createTodoFromExtraction(
  userId: string,
  todo: ExtractedTodo
): number;

/**
 * Get todos by type
 */
export function getTodosByType(
  userId: string,
  type: TodoType
): Todo[];

/**
 * Get todos by child
 */
export function getTodosByChild(
  userId: string,
  childName: string | null
): Todo[];

/**
 * Batch create todos from extraction
 */
export function createTodosBatch(
  userId: string,
  todos: ExtractedTodo[]
): number[];
```

### 3.4 Calendar Integration

**File**: `src/utils/calendarIntegration.ts` (NEW)

**Function**:
```typescript
/**
 * Create calendar event with 7pm reminder day before
 *
 * @param auth - OAuth2 client
 * @param event - Extracted event
 * @returns Created event ID
 */
export async function createCalendarEvent(
  auth: OAuth2Client,
  event: ExtractedEvent
): Promise<string> {
  const calendar = google.calendar({ version: 'v3', auth });

  // Calculate reminder time: 7pm day before
  const eventDate = new Date(event.date);
  const reminderDate = new Date(eventDate);
  reminderDate.setDate(reminderDate.getDate() - 1);
  reminderDate.setHours(19, 0, 0, 0); // 7pm

  const minutesBeforeEvent = Math.floor(
    (eventDate.getTime() - reminderDate.getTime()) / (1000 * 60)
  );

  const calendarEvent = {
    summary: event.title,
    description: event.description || '',
    start: {
      dateTime: event.date,
      timeZone: 'Europe/London', // TODO: Make configurable
    },
    end: {
      dateTime: event.end_date || event.date,
      timeZone: 'Europe/London',
    },
    location: event.location,
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: minutesBeforeEvent },
      ],
    },
  };

  const response = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: calendarEvent,
  });

  return response.data.id!;
}

/**
 * Batch create calendar events
 */
export async function createCalendarEventsBatch(
  auth: OAuth2Client,
  events: ExtractedEvent[]
): Promise<string[]>;
```

---

## Step 4: Personalized Summary Builder

**Goal**: Generate email briefing using stored events, todos, and child profiles.

### New Summary Generation Flow

**File**: `src/utils/personalizedSummaryBuilder.ts` (NEW)

**Function**:
```typescript
/**
 * Generate personalized email briefing
 *
 * @param userId - User ID
 * @param auth - OAuth2 client
 * @param dateRange - How many days ahead to look
 * @returns HTML email content
 */
export async function generatePersonalizedSummary(
  userId: string,
  auth: OAuth2Client,
  dateRange: { start: Date; end: Date }
): Promise<string> {
  // Step 1: Gather structured data
  const calendarEvents = await getCalendarEvents(auth, dateRange);
  const pendingTodos = getTodos(userId, { status: 'pending' });
  const childProfiles = getChildProfiles(userId, true); // active only

  // Step 2: Organize by child
  const dataByChild = organizeByChild(calendarEvents, pendingTodos, childProfiles);

  // Step 3: AI analysis for insights
  const insights = await analyzeWithAI({
    children: childProfiles,
    events: calendarEvents,
    todos: pendingTodos,
    today: new Date(),
  });

  // Step 4: Render HTML email
  return renderPersonalizedEmail({
    dataByChild,
    insights,
    childProfiles,
  });
}
```

### New AI Analysis Prompt (Stage 2)

**Focus**: Provide school-specific insights and organization using structured data.

**Example Prompt**:
```
You are an elite Executive Assistant for busy parents with school-age children.

You have access to:
1. Child profiles (names, year groups, schools)
2. Upcoming calendar events (next 7 days)
3. Pending action items (todos with types)

Your task:
1. Organize information by child (or "General" for family-wide)
2. Identify urgent items (today/tomorrow)
3. Provide helpful insights:
   - "Leo has PE tomorrow - remember to pack kit"
   - "Payment deadline for Ella's trip is Friday"
   - "Busy week ahead: 3 events across both children"
4. Detect conflicts or busy periods
5. Use display names (privacy aliases) if set

Output JSON with:
{
  "by_child": [
    {
      "child_name": "Ella",
      "display_name": "Child A",  // Use if set
      "urgent": [...],            // Today/tomorrow items
      "upcoming": [...],          // This week
      "insights": [...]           // Helpful observations
    }
  ],
  "family_wide": {
    "urgent": [...],
    "insights": [...]
  }
}
```

---

## Implementation Steps

### Phase 1: Database & Type Updates (Week 1)

**Tasks**:
1. ✅ Create `src/types/extraction.ts` - Event and Todo extraction types
2. ✅ Update `src/db/db.ts` - Add new columns to todos table (migration)
3. ✅ Update `src/db/todoDb.ts` - Add new CRUD functions for typed todos
4. ✅ Create `src/utils/calendarIntegration.ts` - Calendar event creation with reminders
5. ✅ Write unit tests for database changes

**Files to Create**:
- `src/types/extraction.ts`
- `src/utils/calendarIntegration.ts`
- `src/db/migrations/001_add_todo_types.ts`

**Files to Modify**:
- `src/db/db.ts`
- `src/db/todoDb.ts`
- `src/types/todo.ts`

---

### Phase 2: AI Extraction (Week 2)

**Tasks**:
1. ✅ Create `src/parsers/eventTodoExtractor.ts` - Event and todo extraction
2. ✅ Design OpenAI JSON Schema for extraction
3. ✅ Implement extraction prompt
4. ✅ Add Anthropic fallback
5. ✅ Write unit tests with sample emails

**Files to Create**:
- `src/parsers/eventTodoExtractor.ts`
- `src/parsers/extractionSchema.ts`
- `tests/parsers/eventTodoExtractor.test.ts`

**Deliverable**: Standalone extractor that takes emails, returns events and todos.

---

### Phase 3: Pipeline Integration (Week 3)

**Tasks**:
1. ✅ Create `src/utils/emailProcessor.ts` - Orchestrates Steps 1-3
2. ✅ Integrate extraction with calendar API
3. ✅ Integrate extraction with todos database
4. ✅ Add idempotency checks (don't re-process same emails)
5. ✅ Create admin endpoint: POST `/admin/process-emails`
6. ✅ Write integration tests

**Files to Create**:
- `src/utils/emailProcessor.ts`
- `src/routes/processingRoutes.ts`

**Files to Modify**:
- `src/app.ts` (register new routes)

**New API Endpoint**:
```typescript
POST /admin/process-emails
Body: {
  dateRange: 'last7days' | 'last30days' | ...,
  dryRun?: boolean  // Preview without saving
}
Response: {
  events_created: number,
  todos_created: number,
  emails_processed: number
}
```

---

### Phase 4: Personalized Summary (Week 4)

**Tasks**:
1. ✅ Create `src/utils/personalizedSummaryBuilder.ts` - New summary generator
2. ✅ Design AI prompt for insights (Stage 2)
3. ✅ Integrate with child profiles
4. ✅ Create HTML email template with child sections
5. ✅ Update daily summary cron job to use new pipeline
6. ✅ Write end-to-end tests

**Files to Create**:
- `src/utils/personalizedSummaryBuilder.ts`
- `src/templates/personalizedSummaryTemplate.ts`

**Files to Modify**:
- `src/plugins/dailySummary.ts` (use new summary builder)
- `src/routes/adminRoutes.ts` (update preview endpoint)

---

### Phase 5: UI Updates (Week 5)

**Tasks**:
1. ✅ Update todo list page to show type badges
2. ✅ Add filter by type (PAY, BUY, PACK, etc.)
3. ✅ Add filter by child
4. ✅ Show source email link on todos
5. ✅ Add "Mark as Done" with completion timestamp
6. ✅ Add type icons/emojis (💰 PAY, 🛍️ BUY, 🎒 PACK, etc.)

**Files to Modify**:
- `src/routes/todoRoutes.ts` (GET /todos with filters)
- Dashboard HTML (add type badges)

**New Todo Card Design**:
```
┌─────────────────────────────────────┐
│ 💰 PAY                         £15.00│
│ School trip to museum               │
│ Due: Friday, Jan 17                 │
│ Child: Ella                         │
│ [View Email] [Pay Now] [Mark Done] │
└─────────────────────────────────────┘
```

---

### Phase 6: Testing & Rollout (Week 6)

**Tasks**:
1. ✅ End-to-end testing with real emails
2. ✅ Performance testing (1000+ emails)
3. ✅ Token usage optimization
4. ✅ Error handling and retry logic
5. ✅ Documentation update
6. ✅ User migration (process last 30 days of emails)
7. ✅ Monitor metrics and logs

---

## Database Schema Changes Summary

### Todos Table - New Columns

```sql
ALTER TABLE todos ADD COLUMN type TEXT NOT NULL DEFAULT 'REMIND'
  CHECK(type IN ('PAY', 'BUY', 'PACK', 'SIGN', 'FILL', 'READ', 'REMIND'));

ALTER TABLE todos ADD COLUMN child_name TEXT;
ALTER TABLE todos ADD COLUMN source_email_id TEXT;
ALTER TABLE todos ADD COLUMN url TEXT;
ALTER TABLE todos ADD COLUMN amount TEXT;
ALTER TABLE todos ADD COLUMN confidence REAL;
ALTER TABLE todos ADD COLUMN completed_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_todos_type ON todos(type);
CREATE INDEX IF NOT EXISTS idx_todos_child ON todos(child_name);
CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);
```

### Migration Script

**File**: `src/db/migrations/001_add_todo_types.ts`

```typescript
export function migrate() {
  // Add columns
  db.exec(`ALTER TABLE todos ADD COLUMN type TEXT NOT NULL DEFAULT 'REMIND';`);
  db.exec(`ALTER TABLE todos ADD COLUMN child_name TEXT;`);
  db.exec(`ALTER TABLE todos ADD COLUMN source_email_id TEXT;`);
  db.exec(`ALTER TABLE todos ADD COLUMN url TEXT;`);
  db.exec(`ALTER TABLE todos ADD COLUMN amount TEXT;`);
  db.exec(`ALTER TABLE todos ADD COLUMN confidence REAL;`);
  db.exec(`ALTER TABLE todos ADD COLUMN completed_at DATETIME;`);

  // Add indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_todos_type ON todos(type);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_todos_child ON todos(child_name);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);`);
}
```

---

## API Changes

### New Endpoints

**Processing**:
```
POST /admin/process-emails
- Trigger email processing pipeline (Steps 1-3)
- Body: { dateRange, dryRun }
- Response: { events_created, todos_created }
```

**Todos**:
```
GET /todos?type=PAY&child=Ella
- Filter todos by type and child
- Response: { todos: [...] }

PUT /todos/:id/complete
- Mark todo as done with completion timestamp
- Response: { success: true }
```

### Updated Endpoints

**Daily Summary**:
```
POST /admin/send-daily-summary
- Now uses personalized summary builder (Step 4)
- Fetches from calendar + todos instead of re-analyzing emails
```

---

## Testing Strategy

### Unit Tests

**Extract & Store**:
- `eventTodoExtractor.test.ts` - AI extraction with sample emails
- `todoDb.test.ts` - New CRUD operations with types
- `calendarIntegration.test.ts` - Calendar event creation

### Integration Tests

**Pipeline**:
- `emailProcessor.test.ts` - Full pipeline Steps 1-3
- `personalizedSummaryBuilder.test.ts` - Summary generation with structured data

### End-to-End Tests

**Real Data**:
- Test with last 7 days of real emails
- Verify events appear in Google Calendar
- Verify todos appear in database
- Verify summary email is personalized

---

## Performance Considerations

### Token Usage

**Before (Current)**:
- Single AI call: ~25,000 tokens (100 emails)
- Cost: ~$0.30 per summary

**After (New)**:
- Extraction AI: ~20,000 tokens (one-time per email batch)
- Summary AI: ~5,000 tokens (using structured data)
- **Total First Run**: ~25,000 tokens (~$0.30)
- **Subsequent Runs**: ~5,000 tokens (~$0.06) ✅ 80% savings

### API Rate Limits

**Calendar API**:
- Limit: 1,000 requests per 100 seconds
- Batch event creation to stay under limit

**OpenAI API**:
- Use exponential backoff for rate limit errors
- Fall back to Anthropic if OpenAI fails

---

## Migration Path

### For Existing Users

**Step 1**: Process last 30 days of emails
```bash
curl -X POST /admin/process-emails \
  -d '{"dateRange": "last30days"}'
```

**Step 2**: Verify data
- Check Google Calendar for events
- Check `/todos` for action items

**Step 3**: Enable new summary
- Update daily summary cron to use new builder

---

## Rollback Plan

If the new pipeline has issues:

1. **Disable processing endpoint**: Comment out route registration
2. **Revert daily summary**: Use old summary generator
3. **Keep new data**: Todos and calendar events remain (no data loss)
4. **Fix issues**: Debug and deploy fix
5. **Re-enable**: Turn on new pipeline

**Key**: Old and new systems can coexist during transition.

---

## Success Metrics

### Quantitative

- **Token usage**: Reduce by 80% for daily summaries
- **Processing time**: <30 seconds for 100 emails
- **Accuracy**: >90% extraction accuracy (events and todos)
- **Calendar events created**: Track count
- **Todos created**: Track count by type

### Qualitative

- **User feedback**: "Summaries feel more personalized"
- **Utility**: Users actually use todo list feature
- **Clarity**: Easier to understand what needs action

---

## Future Enhancements

**Post-MVP**:
1. **Smart Notifications**: Push notifications for urgent todos
2. **Todo Completion via Email**: Reply to summary to mark done
3. **Recurring Events**: Extract recurring activities (PE days)
4. **Payment Tracking**: Mark payments as complete, track spending
5. **Multi-Child Optimization**: Suggest carpools, coordinate schedules
6. **Natural Language Queries**: "What does Ella need this week?"

---

## Dependencies

### Existing (No Changes)
- `googleapis` - Calendar API
- `openai` - AI extraction
- `@anthropic-ai/sdk` - AI fallback
- `better-sqlite3` - Database

### New (To Install)
- None - all existing dependencies sufficient

---

## Documentation Updates

**Files to Update**:
- `README.md` - Add pipeline overview diagram
- `ARCHITECTURE.md` (NEW) - Document new architecture
- `API.md` - Document new endpoints
- `CHILD_PROFILES_IMPLEMENTATION.md` - Link to pipeline integration

---

## Risk Assessment

### High Risk

**AI Extraction Accuracy**:
- **Risk**: AI misclassifies events or todos
- **Mitigation**: Include confidence scores, allow manual review

**Calendar Event Duplication**:
- **Risk**: Creating duplicate events
- **Mitigation**: Check for existing events before creation

### Medium Risk

**Token Costs**:
- **Risk**: Processing large email volumes exceeds budget
- **Mitigation**: Add rate limiting, cap processing per day

**Calendar Reminder Time**:
- **Risk**: 7pm reminder may not suit all users
- **Mitigation**: Make reminder time configurable in settings

### Low Risk

**Database Migration**:
- **Risk**: Adding columns fails for some users
- **Mitigation**: Test migration thoroughly, add rollback script

---

## Timeline Summary

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Phase 1: Database | 1 week | Updated schema, migrations |
| Phase 2: AI Extraction | 1 week | Event/todo extractor |
| Phase 3: Pipeline | 1 week | Processing endpoint |
| Phase 4: Summary | 1 week | Personalized summary |
| Phase 5: UI | 1 week | Todo filters, type badges |
| Phase 6: Testing | 1 week | E2E tests, rollout |
| **Total** | **6 weeks** | Fully mature pipeline |

---

## Conclusion

This refactor transforms the email processing from a monolithic approach into a composable, reusable pipeline. The key benefits are:

1. **Structured Data**: Events and todos are persisted and queryable
2. **Cost Efficiency**: 80% reduction in AI costs for daily summaries
3. **Personalization**: Child profiles integrated into summaries
4. **Extensibility**: Other features can use extracted events/todos
5. **User Control**: Todos visible in UI, can be managed manually

**Next Step**: Begin Phase 1 (Database & Type Updates) after approval of this plan.
