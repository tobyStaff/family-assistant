# Recurring Reminders Implementation Progress

**Status**: Phase 1 Complete ✅
**Last Updated**: 2026-01-12
**Feature**: Automatic detection and storage of recurring school activities from emails

---

## Overview

This feature enables the AI to detect recurring patterns in school emails (e.g., "PE on Monday and Tuesday") and automatically:
1. Extract structured data about the recurring activity
2. Store it in the database (avoiding duplicates)
3. Use it to generate daily reminders
4. Sync to Google Calendar as recurring events

---

## Implementation Progress

### ✅ Phase 1: AI Detection & Database Storage (COMPLETE)

**Completed**: 2026-01-12

#### What Was Implemented:

##### 1. Type System Updates

**File**: `src/types/summary.ts`

Added `recurring_activities` field to the `SchoolSummary` interface:

```typescript
export interface SchoolSummary {
  // ... existing fields ...
  recurring_activities: Array<{
    description: string;      // Activity name (e.g., "PE", "Swimming club")
    child: string;            // Child's name
    days_of_week: number[];   // [1, 2] = Monday, Tuesday (1=Mon, 7=Sun)
    frequency: string;        // "weekly" for now (future: "biweekly")
    requires_kit: boolean;    // Whether kit/equipment is needed
    kit_items?: string[];     // Optional list of kit items
  }>;
  pro_dad_insight: string;
}
```

##### 2. OpenAI JSON Schema Validation

**File**: `src/parsers/schoolSummarySchema.ts`

Added strict schema validation for `recurring_activities` to ensure OpenAI Structured Outputs returns valid data:

```typescript
recurring_activities: {
  type: "array",
  items: {
    type: "object",
    properties: {
      description: { type: "string", description: "..." },
      child: { type: "string", description: "..." },
      days_of_week: {
        type: "array",
        items: { type: "number", minimum: 1, maximum: 7 },
        description: "Days of week (1=Monday, 2=Tuesday, ..., 7=Sunday)"
      },
      frequency: { type: "string", description: "..." },
      requires_kit: { type: "boolean", description: "..." },
      kit_items: {
        type: "array",
        items: { type: "string" },
        description: "..."
      }
    },
    required: ["description", "child", "days_of_week", "frequency", "requires_kit"],
    additionalProperties: false
  }
}
```

Added to required fields array: `"recurring_activities"`

##### 3. AI Prompt Engineering

**File**: `src/parsers/summaryParser.ts`

Added reasoning step 5 **"RECURRING PATTERN DETECTION"**:

```typescript
5. **RECURRING PATTERN DETECTION** (NEW):
   - Look for phrases indicating recurring activities:
     * "PE on Monday and Tuesday", "PE days are Monday and Wednesday"
     * "every Monday", "every Tuesday and Thursday"
     * "Swimming club every Thursday"
     * "[Child name]: PE days on..."
   - Extract to recurring_activities array:
     * description: Activity name (e.g., "PE", "Swimming club", "Forest School")
     * child: Child's name (extract from email context)
     * days_of_week: Array of numbers (1=Monday, 2=Tuesday, ..., 7=Sunday)
     * frequency: "weekly" (only weekly supported for now)
     * requires_kit: true if activity needs equipment/kit
     * kit_items: Array of items if mentioned (e.g., ["PE kit", "trainers"])
   - Examples:
     * "Ella: PE days on Monday and Tuesday this term" →
       {description: "PE", child: "Ella", days_of_week: [1, 2], frequency: "weekly", requires_kit: true, kit_items: ["PE kit"]}
     * "Leo has swimming every Thursday after school" →
       {description: "Swimming", child: "Leo", days_of_week: [4], frequency: "weekly", requires_kit: true, kit_items: ["Swimming kit", "towel"]}
   - If NO recurring patterns detected → recurring_activities: []
```

Added to **STRICT EMPTY VALUE RULES**:
```
- If NO recurring activities detected → recurring_activities: []
```

##### 4. Database Schema

**File**: `src/db/db.ts`

Created new table:

```sql
CREATE TABLE IF NOT EXISTS recurring_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  description TEXT NOT NULL,        -- Activity name (e.g., "PE", "Swimming club")
  child TEXT NOT NULL,               -- Child's name
  days_of_week TEXT NOT NULL,        -- JSON array: [1, 2] for Monday, Tuesday
  frequency TEXT NOT NULL,           -- "weekly" for now (future: "biweekly")
  requires_kit BOOLEAN NOT NULL,     -- Whether kit/equipment is needed
  kit_items TEXT,                    -- JSON array of items (optional)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recurring_user ON recurring_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_recurring_child ON recurring_activities(child);
```

**Database Location**: `/Users/tobystafford/Documents/Dev/inbox-manager/data/app.db`

##### 5. Database API

**File**: `src/db/recurringActivitiesDb.ts` (NEW FILE - 285 lines)

Complete CRUD API with the following functions:

**Core Operations:**
- `createRecurringActivity(activity: RecurringActivity): number` - Create new activity
- `getRecurringActivities(userId: string): RecurringActivity[]` - Get all user activities
- `getRecurringActivitiesByChild(userId: string, child: string): RecurringActivity[]` - Get activities for specific child
- `getRecurringActivity(userId: string, activityId: number): RecurringActivity | null` - Get single activity
- `updateRecurringActivity(userId: string, activityId: number, updates: Partial<RecurringActivity>): boolean` - Update activity
- `deleteRecurringActivity(userId: string, activityId: number): boolean` - Delete activity
- `deleteAllRecurringActivities(userId: string): number` - Delete all user activities

**Duplicate Detection:**
- `findSimilarActivity(activity: RecurringActivity): RecurringActivity | null` - Check for duplicate before creation
  - Matches on: user_id, child, description (case-insensitive)
  - Compares days_of_week as sets (order doesn't matter)

**Helper Queries:**
- `getActivitiesByDay(userId: string, dayOfWeek: number): RecurringActivity[]` - Get activities on specific day
- `getKitActivitiesByDay(userId: string, dayOfWeek: number): RecurringActivity[]` - Get kit-requiring activities on specific day

**Type Interface:**
```typescript
export interface RecurringActivity {
  id?: number;
  user_id: string;
  description: string;
  child: string;
  days_of_week: number[];
  frequency: string;
  requires_kit: boolean;
  kit_items?: string[];
  created_at?: Date;
  updated_at?: Date;
}
```

##### 6. Automatic Storage Integration

**File**: `src/utils/summaryQueries.ts`

Added automatic storage after AI analysis (Step 3.5):

```typescript
// Step 3.5: Store recurring activities (if any detected by AI)
if (summary.recurring_activities && summary.recurring_activities.length > 0) {
  let newActivitiesCount = 0;
  let duplicatesSkipped = 0;

  for (const activity of summary.recurring_activities) {
    // Convert AI output to RecurringActivity format
    const recurringActivity: RecurringActivity = {
      user_id: userId,
      description: activity.description,
      child: activity.child,
      days_of_week: activity.days_of_week,
      frequency: activity.frequency,
      requires_kit: activity.requires_kit,
      kit_items: activity.kit_items,
    };

    // Check if similar activity already exists
    const existing = findSimilarActivity(recurringActivity);

    if (existing) {
      duplicatesSkipped++;
      console.log(`⏭️  Skipping duplicate recurring activity: ...`);
    } else {
      const activityId = createRecurringActivity(recurringActivity);
      newActivitiesCount++;
      console.log(`✅ Created recurring activity #${activityId}: ...`);
    }
  }

  if (newActivitiesCount > 0) {
    console.log(`🔁 Stored ${newActivitiesCount} new recurring activities (${duplicatesSkipped} duplicates skipped)`);
  }
}
```

**Imports Added:**
```typescript
import {
  createRecurringActivity,
  findSimilarActivity,
  type RecurringActivity,
} from '../db/recurringActivitiesDb.js';
```

---

## How It Currently Works

### User Flow:

1. **Email Received**: User receives email like "Ella: PE days on Monday and Tuesday this term"
2. **Summary Generated**: User runs manual summary or scheduled daily summary runs
3. **AI Analysis**: AI detects recurring pattern using new reasoning step
4. **Extraction**: AI extracts structured data:
   ```json
   {
     "description": "PE",
     "child": "Ella",
     "days_of_week": [1, 2],
     "frequency": "weekly",
     "requires_kit": true,
     "kit_items": ["PE kit"]
   }
   ```
5. **Duplicate Check**: System checks if identical activity exists
6. **Storage**: If new, stores in database with ID
7. **Console Log**: Shows result:
   ```
   ✅ Created recurring activity #1: Ella - PE on Mon, Tue
   🔁 Stored 1 new recurring activities (0 duplicates skipped)
   ```

### Example Detection Patterns:

The AI can now detect these patterns:
- "PE on Monday and Tuesday"
- "PE days are Monday and Wednesday this term"
- "Every Monday"
- "Swimming club every Thursday after school"
- "Ella: PE days on Mondays and Tuesdays"
- "Forest School on Fridays"

### Database Query Examples:

```typescript
// Get all recurring activities for a user
const activities = getRecurringActivities(userId);
// Returns: [{ id: 1, description: "PE", child: "Ella", days_of_week: [1, 2], ... }]

// Get activities for Monday
const mondayActivities = getActivitiesByDay(userId, 1);
// Returns all activities that occur on Monday

// Get kit requirements for tomorrow
const tomorrowDay = (new Date().getDay() || 7) + 1; // Convert to 1-7
const kitNeeded = getKitActivitiesByDay(userId, tomorrowDay);
// Returns: [{ description: "PE", child: "Ella", kit_items: ["PE kit"], ... }]

// Check for duplicates before adding
const similar = findSimilarActivity({
  user_id: "user123",
  child: "Ella",
  description: "PE",
  days_of_week: [1, 2],
  frequency: "weekly",
  requires_kit: true
});
// Returns existing activity or null
```

---

## Testing

### Manual Testing:

1. **Start Server**:
   ```bash
   pnpm dev
   ```

2. **Generate Summary** with recurring activity in email:
   - Use admin page: `http://localhost:3000/admin`
   - Or trigger via API: `POST /generate-summary`

3. **Check Logs** for output:
   ```
   ✅ Created recurring activity #1: Ella - PE on Mon, Tue
   🔁 Stored 1 new recurring activities (0 duplicates skipped)
   ```

4. **Verify Database**:
   ```bash
   sqlite3 data/app.db
   SELECT * FROM recurring_activities;
   ```

### Expected Results:

**First Run** (new activity):
```
✅ Created recurring activity #1: Ella - PE on Mon, Tue
🔁 Stored 1 new recurring activities (0 duplicates skipped)
```

**Second Run** (duplicate detected):
```
⏭️  Skipping duplicate recurring activity: Ella - PE on Mon, Tue
```

---

## Files Created/Modified

### New Files (1):
- ✅ `src/db/recurringActivitiesDb.ts` (285 lines) - Complete database API

### Modified Files (4):
- ✅ `src/types/summary.ts` - Added recurring_activities to SchoolSummary interface
- ✅ `src/parsers/schoolSummarySchema.ts` - Added recurring_activities to OpenAI schema
- ✅ `src/parsers/summaryParser.ts` - Added AI pattern detection reasoning step
- ✅ `src/db/db.ts` - Created recurring_activities table
- ✅ `src/utils/summaryQueries.ts` - Added automatic storage logic

---

## Next Phases (Pending)

### 🔄 Phase 2: Daily Reminder Integration

**Goal**: Show recurring activity reminders in daily email summaries

**Tasks**:
1. Add function to calculate upcoming occurrences (today, tomorrow)
2. Update email preprocessor to include recurring reminders in AI context
3. Update email renderer to display recurring reminders section
4. Add "PE today" / "PE tomorrow" notifications with kit requirements

**Files to Modify**:
- `src/utils/emailPreprocessor.ts` - Add recurring context to AI input
- `src/utils/emailRenderer.ts` - Render recurring reminders section
- Create `src/utils/recurringReminders.ts` - Calculate occurrences

**Estimated Time**: 3-4 hours

---

### 🔄 Phase 3: Google Calendar Auto-Sync

**Goal**: Automatically create recurring calendar events

**Tasks**:
1. Create function to sync recurring activities to Google Calendar
2. Use RRULE format for recurring events
3. Handle event updates when activity changes
4. Add sync status tracking (last_synced_at field)

**Files to Create**:
- `src/utils/calendarSync.ts` - Google Calendar RRULE integration

**Files to Modify**:
- `src/db/db.ts` - Add sync tracking fields
- `src/utils/summaryQueries.ts` - Trigger sync after storage

**Estimated Time**: 4-5 hours

---

### 🔄 Phase 4: User Management Dashboard

**Goal**: Allow users to view, edit, and delete recurring activities

**Tasks**:
1. Create routes for CRUD operations
2. Build HTML dashboard with activity list
3. Add inline editing capabilities
4. Show activity calendar view

**Files to Create**:
- `src/routes/recurringActivitiesRoutes.ts` - API routes
- `public/recurring-activities.html` - Dashboard UI (or server-rendered)

**Files to Modify**:
- `src/app.ts` - Register routes
- `src/routes/authRoutes.ts` - Add dashboard link

**Estimated Time**: 4-5 hours

---

### 🔄 Phase 5: Conflict Resolution & Edge Cases

**Goal**: Handle term breaks, conflicts, and schedule changes

**Tasks**:
1. Add term dates to user settings
2. Pause activities during school breaks
3. Handle conflicting activities
4. Support one-off exceptions

**Files to Modify**:
- `src/types/summary.ts` - Add term dates to UserSettings
- `src/db/recurringActivitiesDb.ts` - Add term awareness
- `src/utils/recurringReminders.ts` - Skip breaks

**Estimated Time**: 3-4 hours

---

## User Decisions Made

Based on user feedback during planning:

1. ✅ **No end dates for now** - Activities continue indefinitely until manually deleted
2. ✅ **Auto-sync to calendar** - Automatically create Google Calendar events
3. ✅ **Handle conflicts by showing both** - User resolves manually (for now)
4. ✅ **Weekly only** - Only "weekly" frequency, add biweekly later
5. ✅ **Notify user** - Alert when new recurring activity is detected

---

## Design Decisions

### Days of Week Format:
- **Chosen**: Number array `[1, 2, 3, ...]` where 1=Monday, 7=Sunday
- **Rationale**: Matches ISO 8601 standard, easy to work with in JavaScript
- **Storage**: JSON string in SQLite for flexibility

### Duplicate Detection:
- **Criteria**: Same user, child, description (case-insensitive), and days set
- **Order-agnostic**: `[1, 2]` matches `[2, 1]`
- **Prevents**: Multiple entries for same activity when re-analyzing old emails

### Kit Items:
- **Optional field**: Not all activities require kit
- **Array format**: Allows multiple items (e.g., `["PE kit", "trainers", "water bottle"]`)
- **Storage**: JSON string or NULL in database

---

## Known Limitations

1. **No term dates yet** - Activities don't pause during school breaks
2. **No end dates** - Activities continue until manually deleted
3. **Weekly only** - No biweekly, monthly, or custom frequencies
4. **No exceptions** - Can't mark one-off skipped days
5. **No calendar sync yet** - Phase 3 pending
6. **No user dashboard yet** - Phase 4 pending
7. **No notifications yet** - User not alerted when new activity detected (logs only)

---

## Server Status

✅ **Server Running**: `http://localhost:3000`
✅ **Database**: `/Users/tobystafford/Documents/Dev/inbox-manager/data/app.db`
✅ **Table Created**: `recurring_activities` with 2 indexes
✅ **Compilation**: No errors

Last restart: 2026-01-12 19:59:38

---

## Next Steps

**Recommended**: Continue with Phase 2 (Daily Reminder Integration) to make the stored activities visible in daily summaries.

**Alternative**: Test Phase 1 first by:
1. Running a manual summary with recurring activity emails
2. Verifying database storage
3. Checking for duplicate detection

---

## References

- Original plan: `/Users/tobystafford/Documents/Dev/inbox-manager/RECURRING_REMINDERS_PLAN.md`
- Database schema: `src/db/db.ts:170-194`
- AI prompt: `src/parsers/summaryParser.ts` (reasoning step 5)
- Storage logic: `src/utils/summaryQueries.ts:269-307`
