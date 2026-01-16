# Event Local Storage and Google Calendar Sync - Implementation Plan

## Overview

Transform the event handling system from direct Calendar API writes to a robust database-backed approach with automatic retry, offline support, and full audit trails.

## Requirements Summary

Based on user input:
- ✅ **Queue and retry**: Events stored locally, automatically retry failed syncs
- ✅ **Track changes**: Detect Calendar changes for auditing (no sync back to DB)
- ✅ **Duplicate check**: Local DB first, then Calendar API fallback
- ✅ **UI Display**: New `/events` page + dashboard summary

## Architecture

```
Email → AI Extract → Save to DB (pending) → Sync to Calendar (synced/failed)
                                                      ↓
                                          Cron Retry (every 15 min)
```

---

## Implementation Steps

### Step 1: Database Migration

**File**: `src/db/db.ts`

Add Migration 2 after existing Migration 1:

```typescript
// Migration 2: Create events table (around line 270)
if (version < 2) {
  console.log('Running migration 2: Creating events table');

  db.transaction(() => {
    db.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,

        -- Event data from ExtractedEvent
        title TEXT NOT NULL,
        date TEXT NOT NULL,  -- ISO8601
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

      -- Indexes
      CREATE INDEX idx_events_user_id ON events(user_id);
      CREATE INDEX idx_events_sync_status ON events(sync_status);
      CREATE INDEX idx_events_date ON events(date);
      CREATE INDEX idx_events_child ON events(child_name);
      CREATE INDEX idx_events_google_id ON events(google_calendar_event_id);

      -- Unique constraint for duplicates
      CREATE UNIQUE INDEX idx_events_unique
        ON events(user_id, source_email_id, title, date)
        WHERE source_email_id IS NOT NULL;
    `);

    db.prepare('INSERT INTO schema_version VALUES (?, ?)').run(
      2, 'Create events table with sync tracking'
    );
  })();

  console.log('Migration 2 completed');
}
```

### Step 2: Event Database Layer

**New File**: `src/db/eventDb.ts` (follow todoDb.ts pattern)

Core types:
```typescript
export type EventSyncStatus = 'pending' | 'synced' | 'failed';

export interface Event {
  id: number;
  user_id: string;
  title: string;
  date: Date;
  end_date?: Date;
  description?: string;
  location?: string;
  child_name?: string;
  source_email_id?: string;
  confidence?: number;
  sync_status: EventSyncStatus;
  google_calendar_event_id?: string;
  last_sync_attempt?: Date;
  sync_error?: string;
  retry_count: number;
  created_at: Date;
  updated_at: Date;
  synced_at?: Date;
}
```

Core functions:
- `createEventFromExtraction(userId, event)` - Create from AI extraction
- `createEventsBatch(userId, events[])` - Batch create with transaction
- `listEvents(userId)` - Get all events
- `getEvent(userId, id)` - Get single event
- `getEvents(userId, filters)` - Filter by status/child/date
- `getPendingSyncEvents(userId, maxRetries)` - For retry mechanism
- `markEventSynced(userId, eventId, googleId)` - Update after sync success
- `markEventSyncFailed(userId, eventId, error)` - Update after sync failure
- `eventExistsInDb(userId, sourceEmailId, title, date)` - Duplicate check
- `getUpcomingEvents(userId, daysAhead)` - Dashboard display

### Step 3: Calendar Integration Updates

**File**: `src/utils/calendarIntegration.ts`

Add new sync function:
```typescript
export async function syncEventsToCalendar(
  userId: string,
  auth: OAuth2Client,
  eventIds: number[]
): Promise<{ synced: number; failed: number; errors: any[] }> {
  // For each event:
  // 1. Load from DB
  // 2. Skip if already synced
  // 3. Create in Calendar API
  // 4. Mark as synced/failed in DB
}
```

Add duplicate check:
```typescript
export async function eventExistsAnywhere(
  userId: string,
  auth: OAuth2Client,
  event: ExtractedEvent
): Promise<boolean> {
  // Check local DB first (fast)
  // Fallback to Calendar API (slow)
}
```

### Step 4: Sync Service with Retry

**New File**: `src/utils/eventSyncService.ts`

```typescript
export async function syncPendingEventsForUser(
  userId: string,
  auth: OAuth2Client,
  maxRetries: number = 5
): Promise<{ processed: number; synced: number; failed: number }> {
  // Get pending/failed events (with retry_count < maxRetries)
  // Sync to Calendar
  // Return stats
}

export function calculateBackoffDelay(retryCount: number): number {
  // Exponential backoff: 1min, 2min, 4min, 8min, 16min, cap at 1hr
}
```

### Step 5: Cron Integration

**File**: `src/plugins/dailySummary.ts`

Add to jobs array (around line 85):

```typescript
{
  cronTime: '0 */15 * * * *',  // Every 15 minutes
  name: 'event-sync-retry',
  onTick: async function () {
    // For each user:
    //   Get pending events
    //   Sync to Calendar
    //   Log results
  },
  start: true,
  timeZone: 'UTC',
}
```

Add manual trigger route (after line 280):
```typescript
fastify.get('/admin/trigger-event-sync', async () => {
  const job = fastify.cron.getJobByName('event-sync-retry');
  job.fireOnTick();
  return { success: true };
});
```

### Step 6: Email Processing Update

**File**: `src/utils/emailProcessor.ts`

Replace lines 128-149 (calendar events section):

```typescript
// Save events to DB FIRST
if (extraction.events.length > 0) {
  const { createEventsBatch } = await import('../db/eventDb.js');
  const eventIds = createEventsBatch(userId, extraction.events);

  // Then sync to Calendar
  const { syncEventsToCalendar } = await import('./calendarIntegration.js');
  const syncResult = await syncEventsToCalendar(userId, auth, eventIds);

  result.events_created = syncResult.synced;
  // Failed events will auto-retry via cron
}
```

### Step 7: Event Routes & UI

**New File**: `src/routes/eventRoutes.ts` (mirror todoRoutes.ts structure)

Endpoints:
- `GET /events` - JSON API with filtering
- `GET /events/:id` - Single event JSON
- `POST /events/:id/retry` - Manual retry sync
- `DELETE /events/:id` - Delete event
- `GET /events-view` - HTML view with filters

HTML view features:
- Status badges (🟢 synced, 🟡 pending, 🔴 failed)
- Filter by status, child, date range
- Stats summary (total, synced, pending, failed)
- Retry buttons for failed events
- Delete functionality
- Responsive design matching todos-view

### Step 8: Dashboard Integration

**File**: `src/routes/authRoutes.ts`

In `/dashboard` route (around line 515):

1. Add link to events:
```html
<a href="/events-view" class="api-link">📅 View Events</a>
```

2. Add upcoming events section:
```html
<div class="api-section">
  <h2>📅 Upcoming Events</h2>
  <!-- Next 5 events with sync status badges -->
  <a href="/events-view">View all events →</a>
</div>
```

### Step 9: Route Registration

**File**: `src/app.ts`

Add import and registration:
```typescript
import { eventRoutes } from './routes/eventRoutes.js';

// Around line 94
await fastify.register(eventRoutes);
```

---

## Critical Files to Modify

1. ✅ `src/db/db.ts` - Add Migration 2
2. ✅ `src/db/eventDb.ts` - NEW - Core database layer
3. ✅ `src/utils/calendarIntegration.ts` - Add sync functions
4. ✅ `src/utils/emailProcessor.ts` - DB-first approach
5. ✅ `src/utils/eventSyncService.ts` - NEW - Retry logic
6. ✅ `src/plugins/dailySummary.ts` - Add cron job
7. ✅ `src/routes/eventRoutes.ts` - NEW - Events API & UI
8. ✅ `src/routes/authRoutes.ts` - Dashboard integration
9. ✅ `src/app.ts` - Route registration

---

## Testing & Verification

### Unit Tests
- `src/db/eventDb.test.ts` - Test CRUD, filtering, sync status
- `src/utils/eventSyncService.test.ts` - Test retry logic, backoff

### Manual Testing
1. Process emails → Verify events in DB with status='pending'
2. Check Calendar → Verify events created with status='synced'
3. Simulate failure → Verify retry after 15 min
4. Visit `/events-view` → Verify UI displays all events with filters
5. Test duplicate prevention → Process same email twice
6. Check dashboard → Verify upcoming events display

### Verification Queries
```sql
-- Check events table
SELECT sync_status, COUNT(*) FROM events GROUP BY sync_status;

-- Check pending retries
SELECT * FROM events WHERE sync_status = 'pending' OR sync_status = 'failed';

-- Check recent syncs
SELECT * FROM events WHERE synced_at > datetime('now', '-1 hour');
```

---

## Performance & Scalability

- **5 indexes** for fast filtering (user_id, status, date, child, google_id)
- **Prepared statements** compiled once, reused
- **Batch operations** wrapped in transactions
- **WAL mode** enables concurrent reads during writes
- **Exponential backoff** prevents Calendar API rate limits
- **Unique constraints** prevent duplicate events

---

## Edge Cases Handled

1. ✅ **Calendar API down**: Events saved to DB, auto-retry every 15 min
2. ✅ **Duplicate events**: Unique index on (user_id, source_email_id, title, date)
3. ✅ **OAuth revoked**: Sync fails with auth error, requires re-authentication
4. ✅ **Max retries exceeded**: Events with retry_count >= 5 require manual retry via UI
5. ✅ **Partial failures**: Batch sync continues on individual failures

---

## Future Enhancements (Out of Scope)

- Bidirectional sync (Google Calendar → DB)
- Conflict resolution for concurrent edits
- Webhook integration for real-time Calendar changes
- Batch manual retry UI
- Export events to CSV/iCal
- Event notifications
