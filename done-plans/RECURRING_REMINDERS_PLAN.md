# Recurring Reminders Implementation Plan

## Problem Statement

Currently, the system treats recurring information (e.g., "Ella: PE days on Monday and Tuesday this term") as one-off events. This means:
- ❌ The AI doesn't recognize recurring patterns
- ❌ No calendar events are created for future occurrences
- ❌ Users don't get reminders for recurring activities (PE today/tomorrow)
- ❌ Information is only visible once in the summary, then forgotten

**Goal**: Extract recurring patterns from emails and create persistent reminders that appear in daily summaries.

---

## Example Use Cases

### Use Case 1: Weekly PE Days
**Email**: "Ella: PE days on Monday and Tuesday this term"

**Expected Behavior**:
1. AI extracts: "PE on Monday and Tuesday (recurring weekly until end of term)"
2. System creates recurring calendar events for all Mondays/Tuesdays this term
3. Daily email shows:
   - Monday: "📦 Kit Needed Tomorrow: PE kit - Ella (Tuesday)"
   - Tuesday morning: "🏃 Today: Ella has PE"
   - Friday: "📦 Kit Needed This Week: PE kit - Ella (Monday)"

### Use Case 2: Weekly Club
**Email**: "Leo: Swimming club every Thursday after school"

**Expected Behavior**:
1. AI extracts: "Swimming club on Thursday (recurring weekly)"
2. Calendar events created for all Thursdays
3. Daily email shows reminders for swimming kit/attendance

### Use Case 3: Fortnightly Activity
**Email**: "Forest School every other Friday starting Feb 10th"

**Expected Behavior**:
1. AI extracts: "Forest School on Friday (recurring biweekly from Feb 10th)"
2. Calendar events created for alternate Fridays
3. Reminders appear in daily summaries

---

## Technical Architecture

### Phase 1: AI Pattern Recognition

#### 1.1 Update AI Prompt to Detect Recurring Events
**File**: `src/parsers/summaryParser.ts`

Add new output field to `SchoolSummary` type:
```typescript
recurring_activities: Array<{
  description: string;           // "PE"
  child: string;                 // "Ella"
  days_of_week: number[];        // [1, 2] (Monday=1, Tuesday=2, ..., Sunday=7)
  frequency: string;             // "weekly" | "biweekly" | "monthly"
  start_date?: string;           // ISO8601 (optional, defaults to next occurrence)
  end_date?: string;             // ISO8601 (optional, defaults to end of term)
  requires_kit: boolean;         // true if kit/equipment needed
  kit_items?: string[];          // ["PE kit", "trainers"]
}>;
```

#### 1.2 AI Prompt Instructions
Add reasoning step:
```
5. Recurring Pattern Detection:
   - Look for phrases indicating recurring activities:
     * "every Monday", "every Tuesday"
     * "on Mondays and Thursdays"
     * "PE days are Monday and Wednesday"
     * "every other Friday" (biweekly)
     * "first Monday of each month" (monthly)
   - Extract:
     * Which days of week (Monday=1, ..., Sunday=7)
     * Frequency (weekly, biweekly, monthly)
     * Duration ("this term", "until Easter", specific end date)
     * Child name
     * Activity type
     * Whether kit is required
   - Examples:
     * "Ella: PE days on Monday and Tuesday" → recurring_activities: [{
         description: "PE",
         child: "Ella",
         days_of_week: [1, 2],
         frequency: "weekly",
         requires_kit: true,
         kit_items: ["PE kit"]
       }]
     * "Leo: Swimming club every Thursday" → recurring_activities: [{
         description: "Swimming club",
         child: "Leo",
         days_of_week: [4],
         frequency: "weekly",
         requires_kit: true,
         kit_items: ["Swimming kit", "towel"]
       }]
```

---

### Phase 2: Database Schema

#### 2.1 Create `recurring_activities` Table
**File**: `src/db/db.ts`

```sql
CREATE TABLE IF NOT EXISTS recurring_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  description TEXT NOT NULL,
  child TEXT NOT NULL,
  days_of_week TEXT NOT NULL,  -- JSON array: [1, 2] for Mon, Tue
  frequency TEXT NOT NULL CHECK(frequency IN ('weekly', 'biweekly', 'monthly')),
  start_date DATE,
  end_date DATE,
  requires_kit BOOLEAN DEFAULT 0,
  kit_items TEXT,  -- JSON array: ["PE kit", "trainers"]
  active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recurring_activities_user_id ON recurring_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_recurring_activities_active ON recurring_activities(active);
```

#### 2.2 Create Database API
**File**: `src/db/recurringActivitiesDb.ts`

Functions:
```typescript
export interface RecurringActivity {
  id?: number;
  user_id: string;
  description: string;
  child: string;
  days_of_week: number[];     // [1, 2, 5] for Mon, Tue, Fri
  frequency: 'weekly' | 'biweekly' | 'monthly';
  start_date?: Date;
  end_date?: Date;
  requires_kit: boolean;
  kit_items?: string[];
  active: boolean;
}

// CRUD operations
export function createRecurringActivity(activity: RecurringActivity): number;
export function getRecurringActivities(userId: string): RecurringActivity[];
export function getActiveRecurringActivities(userId: string): RecurringActivity[];
export function updateRecurringActivity(id: number, updates: Partial<RecurringActivity>): boolean;
export function deleteRecurringActivity(id: number): boolean;
export function deactivateRecurringActivity(id: number): boolean;

// Query upcoming occurrences
export function getUpcomingOccurrences(
  userId: string,
  fromDate: Date,
  toDate: Date
): Array<{
  activity: RecurringActivity;
  date: Date;  // Specific occurrence date
}>;
```

---

### Phase 3: Summary Integration

#### 3.1 Store Recurring Activities
**File**: `src/utils/summaryQueries.ts`

After AI analysis completes:
```typescript
// Step 4: Store recurring activities
if (summary.recurring_activities && summary.recurring_activities.length > 0) {
  for (const activity of summary.recurring_activities) {
    // Check if this activity already exists (avoid duplicates)
    const existing = findExistingActivity(userId, activity);

    if (!existing) {
      createRecurringActivity({
        user_id: userId,
        description: activity.description,
        child: activity.child,
        days_of_week: activity.days_of_week,
        frequency: activity.frequency,
        start_date: activity.start_date ? new Date(activity.start_date) : undefined,
        end_date: activity.end_date ? new Date(activity.end_date) : undefined,
        requires_kit: activity.requires_kit,
        kit_items: activity.kit_items,
        active: true,
      });

      console.log(`✅ Created recurring activity: ${activity.description} for ${activity.child}`);
    } else {
      console.log(`ℹ️ Recurring activity already exists: ${activity.description}`);
    }
  }
}
```

#### 3.2 Duplicate Detection Logic
**File**: `src/utils/recurringActivityMatcher.ts`

```typescript
/**
 * Check if a similar recurring activity already exists
 * Matches based on: child name, description similarity, days of week
 */
export function findExistingActivity(
  userId: string,
  newActivity: RecurringActivity
): RecurringActivity | null {
  const existing = getActiveRecurringActivities(userId);

  for (const activity of existing) {
    // Match criteria:
    // 1. Same child
    // 2. Similar description (fuzzy match - "PE" matches "Physical Education")
    // 3. Same days of week (order doesn't matter)
    if (
      activity.child.toLowerCase() === newActivity.child.toLowerCase() &&
      isSimilarDescription(activity.description, newActivity.description) &&
      hasSameDaysOfWeek(activity.days_of_week, newActivity.days_of_week)
    ) {
      return activity;
    }
  }

  return null;
}

function isSimilarDescription(desc1: string, desc2: string): boolean {
  // Normalize: lowercase, remove special chars
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const n1 = normalize(desc1);
  const n2 = normalize(desc2);

  // Check if one contains the other, or Levenshtein distance < 3
  return n1.includes(n2) || n2.includes(n1) || levenshteinDistance(n1, n2) < 3;
}

function hasSameDaysOfWeek(days1: number[], days2: number[]): boolean {
  const set1 = new Set(days1);
  const set2 = new Set(days2);

  if (set1.size !== set2.size) return false;

  for (const day of set1) {
    if (!set2.has(day)) return false;
  }

  return true;
}
```

---

### Phase 4: Daily Email Reminders

#### 4.1 Update Email Preprocessor
**File**: `src/utils/emailPreprocessor.ts`

Add function to fetch upcoming occurrences:
```typescript
export async function prepareEmailsForAI(
  userId: string,
  auth: OAuth2Client,
  emails: EmailMetadata[]
): Promise<InboxAnalysisInput> {
  // ... existing code ...

  // NEW: Add upcoming recurring activities to context
  const upcomingRecurring = getUpcomingOccurrences(
    userId,
    new Date(),              // Today
    addDays(new Date(), 7)   // Next 7 days
  );

  return {
    date: new Date().toISOString(),
    emailCount: emails.length,
    emails,
    upcomingTodos,
    upcomingEvents,
    upcomingRecurring,  // NEW
  };
}
```

#### 4.2 Update AI Prompt to Include Recurring Reminders
**File**: `src/parsers/summaryParser.ts`

Add to prompt:
```typescript
**Context:**
- Date: ${input.date}
- Total emails: ${input.emailCount}
- Upcoming TODOs: ${input.upcomingTodos.length}
- Upcoming calendar events: ${input.upcomingEvents.length}
- Recurring activities this week: ${input.upcomingRecurring.length}  // NEW

**Instructions:**
When generating the summary and kit_list, include reminders for recurring activities:

1. **Kit Needed Tomorrow**:
   - Check if any recurring activities fall tomorrow
   - Example: If tomorrow is Tuesday and Ella has PE on Tuesdays:
     → Add to kit_list.tomorrow: {item: "PE kit", context: "Ella - PE (recurring)"}

2. **Today's Activities**:
   - If today matches a recurring activity day, mention it in summary
   - Example: "Ella has PE today"

3. **Upcoming This Week**:
   - Include recurring activities in kit_list.upcoming
   - Example: {item: "PE kit", day: "Thursday"}

**Input Data:**
${JSON.stringify(input, null, 2)}
```

#### 4.3 Email Renderer Updates
**File**: `src/utils/emailRenderer.ts`

Add visual indicator for recurring items:
```typescript
// In kit_list.tomorrow rendering:
${summary.kit_list.tomorrow.map(kit => `
  <div class="kit-item">
    <strong>${escapeHtml(kit.item)}</strong>
    <div style="color: #666; font-size: 13px;">
      ${escapeHtml(kit.context)}
      ${kit.context.includes('recurring') ? ' <span style="color: #2196f3;">🔄</span>' : ''}
    </div>
  </div>
`).join('')}
```

---

### Phase 5: Calendar Integration (Optional)

#### 5.1 Sync to Google Calendar
**File**: `src/utils/calendarSync.ts`

```typescript
/**
 * Create recurring events in Google Calendar
 * Called after new recurring activity is stored
 */
export async function syncRecurringActivityToCalendar(
  auth: OAuth2Client,
  activity: RecurringActivity
): Promise<void> {
  const calendar = google.calendar({ version: 'v3', auth });

  // Convert to Google Calendar recurrence rule (RRULE)
  const recurrence = buildRecurrenceRule(activity);

  // Create event
  await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: `${activity.child} - ${activity.description}`,
      description: activity.requires_kit
        ? `Required: ${activity.kit_items?.join(', ')}`
        : undefined,
      start: {
        dateTime: getNextOccurrence(activity).toISOString(),
        timeZone: 'Europe/London',
      },
      end: {
        dateTime: addHours(getNextOccurrence(activity), 1).toISOString(),
        timeZone: 'Europe/London',
      },
      recurrence: [recurrence],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 24 * 60 }, // Day before
        ],
      },
    },
  });
}

function buildRecurrenceRule(activity: RecurringActivity): string {
  // Example: "RRULE:FREQ=WEEKLY;BYDAY=MO,TU;UNTIL=20260401T000000Z"
  const daysMap = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const byDay = activity.days_of_week
    .map(day => daysMap[day % 7])
    .join(',');

  let rrule = `RRULE:FREQ=WEEKLY;BYDAY=${byDay}`;

  if (activity.end_date) {
    const until = activity.end_date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    rrule += `;UNTIL=${until}`;
  }

  return rrule;
}
```

---

### Phase 6: User Management

#### 6.1 Dashboard View
**File**: `src/routes/adminRoutes.ts`

Add endpoint:
```typescript
fastify.get('/admin/recurring-activities', { preHandler: requireAuth }, async (request, reply) => {
  const userId = getUserId(request);
  const activities = getActiveRecurringActivities(userId);

  return reply.type('text/html').send(renderRecurringActivitiesPage(activities));
});
```

#### 6.2 HTML Page
```html
<h2>Recurring Activities</h2>
<table>
  <thead>
    <tr>
      <th>Child</th>
      <th>Activity</th>
      <th>Days</th>
      <th>Kit Required</th>
      <th>Actions</th>
    </tr>
  </thead>
  <tbody>
    <!-- List activities with Edit/Delete buttons -->
  </tbody>
</table>
```

#### 6.3 CRUD Endpoints
```typescript
// Deactivate (soft delete)
fastify.post('/admin/recurring-activities/:id/deactivate', ...);

// Reactivate
fastify.post('/admin/recurring-activities/:id/activate', ...);

// Edit
fastify.put('/admin/recurring-activities/:id', ...);
```

---

## Implementation Phases

### Phase 1: AI Detection (2-3 hours)
**Priority**: High
**Deliverables**:
- [ ] Update `SchoolSummary` type with `recurring_activities` field
- [ ] Update AI prompt with recurring pattern detection instructions
- [ ] Add examples to prompt
- [ ] Test AI extraction with sample emails

**Success Criteria**:
- AI correctly extracts "PE on Monday and Tuesday" → `{days_of_week: [1, 2]}`
- AI identifies frequency (weekly, biweekly)
- AI detects kit requirements

---

### Phase 2: Database & Storage (2 hours)
**Priority**: High
**Deliverables**:
- [ ] Create `recurring_activities` table
- [ ] Implement `recurringActivitiesDb.ts` with CRUD functions
- [ ] Implement `getUpcomingOccurrences()` to query next 7 days
- [ ] Add duplicate detection logic

**Success Criteria**:
- Activities persist across server restarts
- Queries return correct occurrences for date ranges
- Duplicate detection prevents multiple entries

---

### Phase 3: Summary Integration (3 hours)
**Priority**: High
**Deliverables**:
- [ ] Store recurring activities after AI analysis
- [ ] Update `prepareEmailsForAI()` to include upcoming occurrences
- [ ] Update AI prompt to use recurring data for kit reminders
- [ ] Update email renderer to show recurring indicators (🔄)

**Success Criteria**:
- New recurring activities automatically saved
- Daily summaries include "PE tomorrow" reminders
- Kit list shows recurring items

---

### Phase 4: User Management (2 hours)
**Priority**: Medium
**Deliverables**:
- [ ] Dashboard page to view/edit recurring activities
- [ ] Deactivate/reactivate endpoints
- [ ] Edit activity endpoint

**Success Criteria**:
- Users can view all recurring activities
- Users can deactivate old activities
- Users can edit days/times

---

### Phase 5: Calendar Sync (3 hours)
**Priority**: Low (Optional)
**Deliverables**:
- [ ] Google Calendar sync function
- [ ] RRULE builder for recurring events
- [ ] Sync button on dashboard

**Success Criteria**:
- Recurring activities appear in Google Calendar
- Calendar shows all future occurrences
- Reminders set for day before

---

## Testing Strategy

### Unit Tests
```typescript
// src/utils/recurringActivityMatcher.test.ts
describe('isSimilarDescription', () => {
  it('should match "PE" and "Physical Education"', () => {
    expect(isSimilarDescription('PE', 'Physical Education')).toBe(true);
  });

  it('should match "Swimming" and "Swimming club"', () => {
    expect(isSimilarDescription('Swimming', 'Swimming club')).toBe(true);
  });
});

describe('getUpcomingOccurrences', () => {
  it('should return Monday and Tuesday occurrences for this week', () => {
    const activity = {
      days_of_week: [1, 2],
      frequency: 'weekly',
      // ...
    };

    const occurrences = getUpcomingOccurrences(userId, today, nextWeek);
    expect(occurrences.length).toBe(2);
  });
});
```

### Integration Tests
1. Send test email: "Ella: PE days on Monday and Tuesday"
2. Verify AI extracts: `{days_of_week: [1, 2]}`
3. Verify database stores activity
4. Verify next day's summary includes "PE tomorrow" if it's Sunday

---

## Edge Cases

### 1. Term End Dates
**Problem**: "PE days this term" - when does it end?

**Solution**:
- Add term calendar to config: `TERM_END_DATE=2026-04-01`
- Default `end_date` to term end if not specified
- Allow manual override

### 2. Conflicting Information
**Problem**: Email says "PE on Monday" but previous email said "PE on Tuesday"

**Solution**:
- Deactivate old activity
- Create new activity
- Log change for user review

### 3. Half Term Breaks
**Problem**: No PE during half term

**Solution**:
- Add break dates to config
- `getUpcomingOccurrences()` skips break dates
- Option to manually mark activity as "on hold"

### 4. One-Off Changes
**Problem**: "No PE next Monday due to school trip"

**Solution**:
- AI detects exceptions: `{exception_dates: ["2026-02-10"]}`
- Skip those specific dates in occurrence generation

---

## Performance Considerations

### Database Queries
- Index on `user_id` and `active` for fast filtering
- `getUpcomingOccurrences()` uses date range query (efficient)
- Expected: < 5ms per query

### AI Prompt Size
- Adding `recurring_activities` to prompt adds ~500 tokens per week
- For 10 recurring activities: ~5KB extra context
- Minimal impact on response time

---

## Rollback Plan

If implementation fails:
```sql
DROP TABLE IF EXISTS recurring_activities;
```

Remove `recurring_activities` field from AI prompt. No impact on existing functionality.

---

## Success Metrics

### Immediate (Week 1)
- ✅ AI extracts recurring patterns from 80%+ of emails
- ✅ Database stores activities correctly
- ✅ Daily summaries include recurring reminders

### Long-term (Month 1)
- ✅ Users report fewer missed PE days
- ✅ Kit reminders reduce "forgot PE kit" incidents
- ✅ 90%+ of recurring activities detected automatically

---

## Alternative Approaches Considered

### Approach A: Manual Entry Only
**Pros**: Simpler implementation
**Cons**: Requires user to manually enter all recurring activities

**Decision**: Rejected - defeats purpose of AI automation

### Approach B: Google Calendar Only
**Pros**: Leverages existing calendar infrastructure
**Cons**: Doesn't extract from emails automatically, requires manual calendar entry

**Decision**: Rejected - doesn't solve the extraction problem

### Approach C: AI + Database (Chosen)
**Pros**: Automatic extraction, persistent storage, flexible queries
**Cons**: More complex implementation

**Decision**: Selected - best balance of automation and control

---

## Next Steps

1. **Review this plan** - Confirm approach and priorities
2. **Phase 1 implementation** - Start with AI detection
3. **Test with real data** - Verify extraction accuracy
4. **Iterate based on feedback** - Refine as needed

---

## Questions for Review

1. Should we default `end_date` to end of current school term?
2. Should we sync to Google Calendar automatically, or require user action?
3. How should we handle conflicts when new emails contradict old activities?
4. Should we support "every other week" (biweekly) in Phase 1, or add later?
5. Do we need a notification when a new recurring activity is detected?
