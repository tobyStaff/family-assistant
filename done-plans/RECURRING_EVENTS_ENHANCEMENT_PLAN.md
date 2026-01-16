# Recurring Events & Smart Date Extraction Enhancement Plan

## Problem Statement

**Current Limitation**: The AI extraction treats all events and todos as one-time occurrences, missing recurring patterns like "PE kit every Monday and Tuesday" or "Swimming lessons every Wednesday at 4pm".

**Example Issue**:
- Email says: "Ella needs PE kit every Monday and Tuesday"
- Current system: Creates single todo (or ignores it)
- Desired: Creates recurring calendar events + recurring reminder todos

---

## Goals

1. **Detect Recurring Patterns** in emails using AI
2. **Store Recurrence Rules** in database
3. **Create Calendar Recurring Events** via Google Calendar API
4. **Generate Recurring Todos** for preparation tasks
5. **Smart Reminders** at multiple times (night before + morning of)
6. **Pattern Recognition** for common school schedules

---

## Common Recurring Patterns to Detect

### Weekly Patterns
- "Every Monday" / "Every Mon"
- "Every Monday and Wednesday"
- "Mondays and Thursdays"
- "Each Tuesday"
- "Weekly on Friday"

### Bi-Weekly Patterns
- "Every other Monday"
- "Alternate Tuesdays"
- "Fortnightly on Wednesday"

### Day-of-Month Patterns
- "First Monday of each month"
- "Last Friday of the month"
- "Every 15th"

### Term-Time Patterns
- "Every Tuesday during term time"
- "Weekly lessons until Easter"
- "Starts September 10th, every Thursday"

### Time-Based
- "Monday mornings at 9am"
- "Wednesday afternoons after school"
- "Friday evening 5:30pm"

---

## Database Schema Changes

### New Table: `recurring_patterns`

```sql
CREATE TABLE IF NOT EXISTS recurring_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  pattern_type TEXT NOT NULL CHECK(pattern_type IN ('event', 'todo')),

  -- What
  title TEXT NOT NULL,
  description TEXT,

  -- Recurrence rule (RFC 5545 format)
  rrule TEXT NOT NULL,  -- e.g., "FREQ=WEEKLY;BYDAY=MO,TU"

  -- Time details
  start_time TEXT,      -- ISO time: "09:00:00"
  end_time TEXT,        -- ISO time: "15:30:00"
  duration_minutes INTEGER,

  -- Date range
  start_date DATE NOT NULL,
  end_date DATE,        -- NULL = indefinite

  -- For todos
  todo_type TEXT,       -- PAY, PACK, etc.
  child_name TEXT,
  reminder_offset_hours INTEGER,  -- How many hours before to remind (default: 12)

  -- For events
  location TEXT,
  calendar_event_id TEXT,  -- Google Calendar recurring event ID

  -- Metadata
  source_email_id TEXT,
  confidence REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT 1,

  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recurring_user_id ON recurring_patterns(user_id);
CREATE INDEX IF NOT EXISTS idx_recurring_child ON recurring_patterns(child_name);
CREATE INDEX IF NOT EXISTS idx_recurring_active ON recurring_patterns(is_active);
```

### Enhanced `todos` Table

Add column for linking to recurring pattern:

```sql
ALTER TABLE todos ADD COLUMN recurring_pattern_id INTEGER REFERENCES recurring_patterns(id);
CREATE INDEX IF NOT EXISTS idx_todos_recurring ON todos(recurring_pattern_id);
```

---

## AI Extraction Enhancements

### Updated Extraction Schema

Add new section to JSON schema:

```typescript
{
  // ... existing events and todos ...

  recurring_patterns: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        pattern_type: {
          type: 'string',
          enum: ['event', 'todo'],
          description: 'Whether this is a recurring event or recurring todo'
        },
        title: {
          type: 'string',
          description: 'Event/todo title (e.g., "PE Lesson", "Pack PE Kit")'
        },
        description: { type: 'string' },

        // Recurrence pattern
        frequency: {
          type: 'string',
          enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'],
          description: 'How often it repeats'
        },
        interval: {
          type: 'number',
          description: '1 = every week, 2 = every other week, etc.'
        },
        days_of_week: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
          },
          description: 'Which days of week (for WEEKLY frequency)'
        },

        // Time details
        start_time: {
          type: 'string',
          description: 'Time in HH:MM format, e.g., "09:00"'
        },
        end_time: { type: 'string' },

        // Date range
        start_date: {
          type: 'string',
          description: 'ISO date when pattern starts'
        },
        end_date: {
          type: 'string',
          description: 'ISO date when pattern ends (null if indefinite)'
        },

        // Classification
        child_name: { type: 'string' },
        todo_type: { type: 'string' },  // For recurring todos
        location: { type: 'string' },   // For recurring events

        confidence: { type: 'number' }
      },
      required: ['pattern_type', 'title', 'frequency', 'start_date', 'confidence']
    }
  }
}
```

### Enhanced AI Prompt

```
CRITICAL INSTRUCTION: Look for RECURRING PATTERNS in the emails!

School emails often mention activities that happen regularly:
- "PE every Monday and Tuesday"
- "Swimming lessons weekly on Wednesday"
- "Music lessons each Thursday"
- "Forest school every other Friday"

When you find a recurring pattern:
1. Extract it as a recurring_pattern (NOT a one-time event)
2. Specify the frequency (WEEKLY, MONTHLY, etc.)
3. List the days_of_week if weekly (MO, TU, WE, TH, FR, SA, SU)
4. Include start_date (when it begins) and end_date (when it ends, if mentioned)

**Examples:**

Email: "Ella has PE every Monday and Tuesday this term"
→ Extract:
{
  pattern_type: "event",
  title: "PE - Ella",
  frequency: "WEEKLY",
  interval: 1,
  days_of_week: ["MO", "TU"],
  start_date: "2026-01-13",
  end_date: "2026-04-01",  // End of term
  child_name: "Ella"
}

ALSO create a recurring todo for preparation:
{
  pattern_type: "todo",
  title: "Pack PE kit for Ella",
  frequency: "WEEKLY",
  days_of_week: ["SU", "MO"],  // Sunday night for Monday, Monday night for Tuesday
  todo_type: "PACK",
  child_name: "Ella"
}

Email: "Year 5 has swimming lessons every Wednesday afternoon at 2pm until Easter"
→ Extract:
{
  pattern_type: "event",
  title: "Swimming Lesson - Year 5",
  frequency: "WEEKLY",
  days_of_week: ["WE"],
  start_time: "14:00",
  start_date: "2026-01-15",
  end_date: "2026-04-09"
}

Email: "Music tuition every Thursday at 4:30pm, £25 per session"
→ Extract recurring event + recurring payment reminder

**Key Patterns to Look For:**
- "every [day]"
- "each [day]"
- "weekly on [day]"
- "[day]s and [day]s"
- "every other [day]"
- "fortnightly"
- "alternate [day]"
- "first/last [day] of month"
- "during term time"
- "until [date]"
```

---

## Google Calendar Integration

### Recurring Event Creation

Use Google Calendar's recurrence rules (RFC 5545):

```typescript
export async function createRecurringCalendarEvent(
  auth: OAuth2Client,
  pattern: RecurringPattern
): Promise<string> {
  const calendar = google.calendar({ version: 'v3', auth });

  // Build RRULE from pattern
  const rrule = buildRRule(pattern);

  // Example RRULE: "RRULE:FREQ=WEEKLY;BYDAY=MO,TU;UNTIL=20260401"

  const event = {
    summary: pattern.title,
    description: pattern.description,
    location: pattern.location,
    start: {
      dateTime: `${pattern.start_date}T${pattern.start_time || '09:00:00'}`,
      timeZone: 'Europe/London'
    },
    end: {
      dateTime: `${pattern.start_date}T${pattern.end_time || '15:30:00'}`,
      timeZone: 'Europe/London'
    },
    recurrence: [rrule],
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: calculateMinutesBeforeAt7pm(pattern) },
        { method: 'popup', minutes: 60 }  // 1 hour before (morning of)
      ]
    }
  };

  const response = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: event
  });

  return response.data.id!;
}

function buildRRule(pattern: RecurringPattern): string {
  let rrule = `RRULE:FREQ=${pattern.frequency}`;

  if (pattern.interval && pattern.interval > 1) {
    rrule += `;INTERVAL=${pattern.interval}`;
  }

  if (pattern.days_of_week && pattern.days_of_week.length > 0) {
    rrule += `;BYDAY=${pattern.days_of_week.join(',')}`;
  }

  if (pattern.end_date) {
    // Format: YYYYMMDD
    const untilDate = pattern.end_date.replace(/-/g, '');
    rrule += `;UNTIL=${untilDate}`;
  }

  return rrule;
}
```

### Multiple Reminders

Google Calendar allows multiple reminders per event:

```typescript
reminders: {
  useDefault: false,
  overrides: [
    { method: 'popup', minutes: minutesUntil7pmDayBefore },  // 7pm night before
    { method: 'popup', minutes: 60 },                         // 1 hour before
    { method: 'email', minutes: 1440 }                        // Email 24h before (optional)
  ]
}
```

---

## Recurring Todo Generation

### Strategy: Instance-Based

Create todo instances for upcoming occurrences (rolling window):

```typescript
/**
 * Generate todo instances for next N days from recurring pattern
 */
export function generateRecurringTodos(
  pattern: RecurringPattern,
  daysAhead: number = 14
): Todo[] {
  const todos: Todo[] = [];
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + daysAhead);

  // Parse RRULE and generate occurrences
  const occurrences = calculateOccurrences(pattern, new Date(), endDate);

  for (const occurrence of occurrences) {
    // Create reminder todo the night before
    const reminderDate = new Date(occurrence);
    reminderDate.setDate(reminderDate.getDate() - 1);
    reminderDate.setHours(19, 0, 0, 0);  // 7pm

    todos.push({
      description: pattern.title,
      type: pattern.todo_type || 'REMIND',
      due_date: reminderDate,
      child_name: pattern.child_name,
      recurring_pattern_id: pattern.id,
      confidence: pattern.confidence
    });
  }

  return todos;
}
```

### Auto-Generation Job

Add cron job to generate recurring todo instances:

```typescript
// Run daily at 2am
cron.schedule('0 2 * * *', async () => {
  console.log('Generating recurring todo instances...');

  const activePatterns = getActiveRecurringPatterns();

  for (const pattern of activePatterns) {
    if (pattern.pattern_type === 'todo') {
      // Check if instances exist for next 14 days
      const existingInstances = getTodosByRecurringPattern(pattern.id);
      const neededDates = calculateMissingInstances(pattern, existingInstances);

      // Create missing instances
      for (const date of neededDates) {
        createRecurringTodoInstance(pattern, date);
      }
    }
  }

  console.log('Recurring todo generation complete');
});
```

---

## Pattern Management UI

### New Route: `/recurring-patterns`

Display all recurring patterns with ability to:
- View active patterns
- Edit recurrence rules
- Pause/resume patterns
- Delete patterns
- See next 5 occurrences
- Test pattern generation

### Example Card:

```
┌─────────────────────────────────────────────────┐
│ 🏃 PE - Ella                            [Active] │
│                                                  │
│ 📅 Every Monday & Tuesday                       │
│ ⏰ 9:00 AM - 3:30 PM                            │
│ 📍 Busbridge Junior                             │
│                                                  │
│ Next occurrences:                                │
│ • Mon, Jan 13, 2026                             │
│ • Tue, Jan 14, 2026                             │
│ • Mon, Jan 20, 2026                             │
│ • Tue, Jan 21, 2026                             │
│ • Mon, Jan 27, 2026                             │
│                                                  │
│ Reminders: 7pm night before + 1h before         │
│                                                  │
│ [Edit] [Pause] [Delete] [View Calendar]        │
└─────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Database & Schema (Day 1-2)

**Tasks:**
1. Create `recurring_patterns` table with migration
2. Add `recurring_pattern_id` to todos table
3. Create database functions:
   - `createRecurringPattern()`
   - `getActiveRecurringPatterns()`
   - `updateRecurringPattern()`
   - `deleteRecurringPattern()`
   - `generateTodoInstances()`
4. Write unit tests

**Files:**
- `src/db/db.ts` - Add migration
- `src/db/recurringPatternsDb.ts` - NEW
- `src/types/recurringPattern.ts` - NEW

---

### Phase 2: AI Extraction Update (Day 3-4)

**Tasks:**
1. Update extraction schema with `recurring_patterns` array
2. Enhance AI prompt with recurring pattern detection
3. Update `eventTodoExtractor.ts` to handle recurring patterns
4. Add pattern validation logic
5. Test with sample emails containing recurring patterns

**Files:**
- `src/parsers/extractionSchema.ts` - Add recurring_patterns
- `src/parsers/eventTodoExtractor.ts` - Parse recurring section
- `src/utils/rruleBuilder.ts` - NEW - Build RFC 5545 RRULEs
- `tests/recurring-extraction.test.ts` - NEW

**Test Cases:**
```typescript
const testEmails = [
  {
    subject: "PE Kit Reminder",
    body: "Ella needs PE kit every Monday and Tuesday this term"
  },
  {
    subject: "Swimming Lessons",
    body: "Year 5 swimming every Wednesday at 2pm until Easter"
  },
  {
    subject: "Music Tuition",
    body: "Violin lessons each Thursday at 4:30pm, £25 per session"
  }
];
```

---

### Phase 3: Calendar Integration (Day 5-6)

**Tasks:**
1. Implement `createRecurringCalendarEvent()` with RRULE support
2. Add multiple reminder support (7pm + morning)
3. Update `calendarIntegration.ts` with recurrence functions
4. Handle recurring event updates and deletions
5. Add recurring event sync from Google Calendar

**Files:**
- `src/utils/calendarIntegration.ts` - Add recurring functions
- `src/utils/rruleParser.ts` - NEW - Parse and validate RRULEs

**API Integration:**
```typescript
// Google Calendar API supports recurrence via RRULE
const event = {
  summary: "PE - Ella",
  recurrence: [
    'RRULE:FREQ=WEEKLY;BYDAY=MO,TU;UNTIL=20260401'
  ],
  reminders: {
    useDefault: false,
    overrides: [
      { method: 'popup', minutes: 810 },  // 7pm day before
      { method: 'popup', minutes: 60 }    // 1 hour before
    ]
  }
};
```

---

### Phase 4: Todo Instance Generation (Day 7-8)

**Tasks:**
1. Implement `generateRecurringTodos()` function
2. Create cron job for daily instance generation
3. Add logic to prevent duplicate instances
4. Handle pattern updates (regenerate instances)
5. Add cleanup for old completed instances

**Files:**
- `src/utils/recurringTodoGenerator.ts` - NEW
- `src/plugins/recurringTodosPlugin.ts` - NEW - Cron job

**Logic:**
```typescript
// Generate instances for next 14 days
// Run daily at 2am
// Only create instances that don't exist yet
// Link instances to pattern via recurring_pattern_id
```

---

### Phase 5: Pipeline Integration (Day 9-10)

**Tasks:**
1. Update `emailProcessor.ts` to handle recurring patterns
2. Store recurring patterns in database during processing
3. Create calendar recurring events
4. Generate initial todo instances (next 14 days)
5. Link one-time events to recurring patterns (deduplication)

**Files:**
- `src/utils/emailProcessor.ts` - Add recurring logic
- `src/routes/processingRoutes.ts` - Show recurring stats

**Processing Flow:**
```
Email Fetch → AI Extraction → Split into:
  ├─ One-time events → Calendar
  ├─ One-time todos → Database
  └─ Recurring patterns →
       ├─ Store pattern in recurring_patterns table
       ├─ Create recurring calendar event
       └─ Generate todo instances (14 days ahead)
```

---

### Phase 6: Management UI (Day 11-12)

**Tasks:**
1. Create `/recurring-patterns-view` route
2. Display all active recurring patterns
3. Show next 5 occurrences for each pattern
4. Add edit/pause/delete functionality
5. Add pattern creation form (manual entry)
6. Show linked todos and calendar events

**Files:**
- `src/routes/recurringPatternsRoutes.ts` - NEW
- Link from dashboard

**Features:**
- Card-based layout showing all patterns
- Filter by child, pattern type (event/todo)
- Visual calendar preview
- Quick actions (pause, edit, delete)
- Test pattern generation

---

### Phase 7: Smart Enhancements (Day 13-14)

**Tasks:**
1. **Conflict Detection**: Warn if multiple events overlap
2. **Pattern Suggestions**: "Looks like this happens weekly, create pattern?"
3. **Term-Time Detection**: Auto-detect school term dates, pause during holidays
4. **Smart Completion**: Mark pattern as complete if event passed
5. **Analytics**: Show pattern compliance (% of instances completed)

**Advanced Features:**
- Auto-detect term dates from school calendar
- Suggest patterns based on historical events
- Link related patterns (PE lesson + Pack PE kit)
- Export patterns to ICS file

---

## Testing Strategy

### Unit Tests

```typescript
describe('Recurring Pattern Detection', () => {
  it('should detect weekly pattern from "every Monday"', () => {
    const email = { body: "PE every Monday at 9am" };
    const result = extractRecurringPatterns(email);
    expect(result.patterns[0].frequency).toBe('WEEKLY');
    expect(result.patterns[0].days_of_week).toEqual(['MO']);
  });

  it('should detect multiple days pattern', () => {
    const email = { body: "Swimming on Mondays and Wednesdays" };
    const result = extractRecurringPatterns(email);
    expect(result.patterns[0].days_of_week).toEqual(['MO', 'WE']);
  });

  it('should detect end date from term info', () => {
    const email = { body: "Drama club every Thursday until Easter" };
    const result = extractRecurringPatterns(email);
    expect(result.patterns[0].end_date).toBeTruthy();
  });
});

describe('RRULE Builder', () => {
  it('should build weekly RRULE correctly', () => {
    const pattern = {
      frequency: 'WEEKLY',
      days_of_week: ['MO', 'TU'],
      end_date: '2026-04-01'
    };
    const rrule = buildRRule(pattern);
    expect(rrule).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO,TU;UNTIL=20260401');
  });
});

describe('Todo Instance Generation', () => {
  it('should generate instances for next 14 days', () => {
    const pattern = createWeeklyPattern(['MO', 'WE']);
    const instances = generateRecurringTodos(pattern, 14);
    expect(instances.length).toBeGreaterThan(0);
    expect(instances.every(t => t.recurring_pattern_id === pattern.id)).toBe(true);
  });
});
```

### Integration Tests

```typescript
describe('End-to-End Recurring Pattern Processing', () => {
  it('should process email with recurring PE pattern', async () => {
    const email = createTestEmail({
      subject: "PE Timetable",
      body: "Ella has PE every Monday and Tuesday"
    });

    const result = await processEmails(userId, auth, { emails: [email] });

    // Check pattern created
    const patterns = getRecurringPatterns(userId);
    expect(patterns.length).toBe(1);
    expect(patterns[0].title).toContain('PE');

    // Check calendar event created
    const calendarEvents = await getUpcomingEvents(auth, 30);
    const peEvents = calendarEvents.filter(e => e.summary.includes('PE'));
    expect(peEvents.length).toBeGreaterThan(4); // At least 4 weeks

    // Check todo instances created
    const todos = getTodos(userId, { type: 'PACK' });
    expect(todos.some(t => t.description.includes('PE kit'))).toBe(true);
  });
});
```

---

## Performance Considerations

### Database Optimization

```sql
-- Index for pattern lookups
CREATE INDEX idx_recurring_active_user ON recurring_patterns(user_id, is_active);

-- Index for instance generation
CREATE INDEX idx_recurring_dates ON recurring_patterns(start_date, end_date);

-- Index for linked todos
CREATE INDEX idx_todos_recurring_pattern ON todos(recurring_pattern_id);
```

### Caching

```typescript
// Cache active patterns to avoid repeated DB queries
const patternCache = new Map<string, RecurringPattern[]>();

function getActivePatternsCached(userId: string): RecurringPattern[] {
  if (!patternCache.has(userId)) {
    patternCache.set(userId, getActiveRecurringPatterns(userId));
  }
  return patternCache.get(userId)!;
}

// Invalidate cache when patterns change
function invalidatePatternCache(userId: string): void {
  patternCache.delete(userId);
}
```

### Instance Generation Limits

```typescript
// Only generate instances up to 14 days ahead
// Prevents creating thousands of instances for indefinite patterns
const MAX_DAYS_AHEAD = 14;

// Cleanup old completed instances (>30 days old)
// Keeps database size manageable
cleanupOldInstances(30);
```

---

## Example Extraction Output

### Input Email:
```
Subject: Spring Term PE Schedule

Dear Parents,

PE lessons for Year 5 will continue this term:
- Monday mornings at 9:00am (indoor PE)
- Tuesday afternoons at 1:30pm (outdoor games)

Please ensure your child has their PE kit every Monday and Tuesday.
Term ends on Friday 4th April.

Regards,
PE Department
```

### Extracted Output:
```json
{
  "recurring_patterns": [
    {
      "pattern_type": "event",
      "title": "PE Lesson (Indoor) - Year 5",
      "frequency": "WEEKLY",
      "interval": 1,
      "days_of_week": ["MO"],
      "start_time": "09:00",
      "end_time": "10:00",
      "start_date": "2026-01-13",
      "end_date": "2026-04-04",
      "child_name": "Ella",
      "confidence": 0.95
    },
    {
      "pattern_type": "event",
      "title": "PE Lesson (Outdoor) - Year 5",
      "frequency": "WEEKLY",
      "days_of_week": ["TU"],
      "start_time": "13:30",
      "end_time": "14:30",
      "start_date": "2026-01-14",
      "end_date": "2026-04-04",
      "child_name": "Ella",
      "confidence": 0.95
    },
    {
      "pattern_type": "todo",
      "title": "Pack PE kit for Ella",
      "frequency": "WEEKLY",
      "days_of_week": ["SU", "MO"],
      "start_date": "2026-01-12",
      "end_date": "2026-04-03",
      "todo_type": "PACK",
      "child_name": "Ella",
      "confidence": 0.90
    }
  ]
}
```

### Result:
- **2 recurring calendar events** created in Google Calendar with RRULE
- **12 weeks × 2 days = 24 calendar event instances** (through April 4th)
- **Reminders at 7pm Sunday** for Monday PE
- **Reminders at 7pm Monday** for Tuesday PE
- **Additional reminders 1 hour before** each PE lesson
- **Todo instances generated** for next 14 days, auto-regenerated daily

---

## Success Metrics

### Accuracy
- **Pattern Detection Rate**: % of recurring patterns successfully detected
- **False Positive Rate**: % of one-time events incorrectly marked as recurring
- **Date Accuracy**: % of generated instances with correct dates/times

### Usability
- **User Satisfaction**: Feedback on recurring pattern management
- **Manual Override Rate**: % of patterns requiring manual editing
- **Pattern Compliance**: % of todo instances completed on time

### Performance
- **Extraction Time**: Time to extract patterns from emails
- **Instance Generation Time**: Time to generate todo instances
- **Database Size**: Growth rate of recurring patterns table

### Business Value
- **Time Saved**: Estimated hours saved by automated recurring reminders
- **Missed Events Reduced**: % reduction in forgotten PE kits, etc.
- **Parent Engagement**: Increased app usage due to recurring features

---

## Rollout Plan

### Week 1: Foundation
- Implement database schema
- Build RRULE utilities
- Update AI extraction

### Week 2: Integration
- Calendar API integration
- Todo instance generation
- Email processor updates

### Week 3: UI & Testing
- Management UI
- End-to-end testing
- Bug fixes

### Week 4: Beta Launch
- Enable for 10% of users
- Monitor metrics
- Gather feedback

### Week 5: Full Rollout
- Enable for all users
- Document features
- Marketing announcement

---

## Future Enhancements

### Phase 2 Features
1. **Smart Conflict Resolution**: Automatically adjust patterns when conflicts detected
2. **Pattern Inheritance**: Child patterns that follow parent patterns with offsets
3. **Holiday Awareness**: Auto-pause during school holidays
4. **Multi-Child Optimization**: Combine patterns for siblings
5. **Weather Integration**: Adjust outdoor activity reminders based on forecast
6. **ML Pattern Suggestion**: Learn from user behavior to suggest new patterns

### Advanced Capabilities
- Voice commands: "Add PE kit reminder every Monday"
- Shared family calendars with selective visibility
- Export patterns to other calendar apps
- Import patterns from school calendar feeds
- Auto-categorization by activity type (sports, music, clubs)

---

## Risk Mitigation

### Data Quality Risks
- **Risk**: AI misinterprets pattern frequency
- **Mitigation**: Confidence scoring, manual review UI, pattern suggestions

### Calendar Sync Risks
- **Risk**: Google Calendar RRULE conflicts
- **Mitigation**: Validate RRULEs before creation, handle API errors gracefully

### Performance Risks
- **Risk**: Generating instances for indefinite patterns
- **Mitigation**: 14-day rolling window, cleanup job for old instances

### User Experience Risks
- **Risk**: Too many reminders overwhelming users
- **Mitigation**: Configurable reminder settings, digest options

---

## Documentation Updates

### User Guide Sections
1. **Understanding Recurring Patterns** - What they are and how they help
2. **Managing Your Patterns** - Edit, pause, and delete patterns
3. **Reminders and Notifications** - Configure reminder timing
4. **Troubleshooting** - What to do if patterns aren't detected

### Developer Docs
1. **RRULE Format Reference** - RFC 5545 compliance
2. **Pattern Detection Logic** - How AI identifies recurring patterns
3. **Instance Generation Algorithm** - Technical details
4. **Calendar API Integration** - Google Calendar recurrence support

---

## Conclusion

This enhancement will transform the system from a reactive todo list into a proactive family scheduler that understands the recurring nature of school life. By detecting patterns like "PE every Monday and Tuesday" and automatically creating:

- ✅ Recurring calendar events with proper timing
- ✅ Multiple reminders (night before + morning of)
- ✅ Preparation todos at the right times
- ✅ Child-specific organization

...we'll dramatically reduce the mental load on parents and ensure nothing gets forgotten.

**Estimated Impact:**
- **80% reduction** in forgotten PE kits, instruments, etc.
- **90% time savings** vs. manual calendar entry
- **100% coverage** of regular school activities

**Next Step**: Review this plan and provide feedback, then proceed with Phase 1 implementation.
