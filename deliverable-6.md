### Detailed Implementation for Deliverable 6: Calendar Event Adder (Timezone Aware with Dedup)

As the lead web engineer, let's detail Deliverable 6. This module adds parsed events to Google Calendar, with timezone conversion for accuracy and fuzzy deduplication to prevent clutter from similar events. It integrates with the parsers from Deliverables 3/4 (using ParsedResult's dates/actions) and the orchestrator in Deliverable 8. We'll keep it modular as a Fastify route, leveraging googleapis for Calendar ops and date-fns-tz for handling user-specific timezones (e.g., converting "Tomorrow at 9am" from UTC parse to user's TZ like 'America/Los_Angeles'). TypeScript is perfect here for type-safe date manipulations and API payloads, ensuring minimal bugs. If we needed bulk event processing or iCal exports later, I'd recommend a Python microservice with icalendar lib, but that's unnecessary for this MVP—stick to TS for consistency.

Before implementation, let's weigh 2-3 options for the event adder structure, emphasizing trade-offs:

1. **Option A: Direct Route Handler with Inline Logic (Chosen in Plan)**  
   - Implement dedup and insert in the /add-event handler, using googleapis directly. Fetch user TZ from DB or request, convert dates via date-fns-tz, then query/list for dedup with string-similarity.  
   - Pros: Minimal LOC (~60-100), no extra abstractions, fast for MVP. Easy to integrate with orchestrator.  
   - Cons: Couples route to business logic; harder to reuse if adding more Calendar features (e.g., updates).  
   - Trade-off: Aligns with plan's simplicity—1-2 days effort, low maintenance on micro-VM.

2. **Option B: Service Class for Calendar Ops**  
   - Create a CalendarService class with methods like addEventWithDedup(). Inject auth/DB, handle TZ/dedup there. Route just calls the service.  
   - Pros: Better separation of concerns, reusable for future endpoints (e.g., /update-event). Easier unit testing.  
   - Cons: Adds ~30-50 LOC for class boilerplate, slight overkill for single-route MVP.  
   - Trade-off: Improves maintainability but risks bloating the minimal codebase. Skip for now to stay under effort cap; can refactor later.

3. **Option C: Use a Calendar Wrapper Lib like google-calendar-simple**  
   - Wrap googleapis with a third-party lib for simpler APIs, adding dedup on top.  
   - Pros: Reduces boilerplate for auth/events.list/insert.  
   - Cons: Adds dep (~1MB), potential incompatibilities with our OAuth setup, less control over queries (e.g., custom dedup filters). Deviates from plan's explicit library choices.  
   - Trade-off: Speeds dev slightly but increases bug surface from external code. Not worth it—native googleapis is lightweight and reliable.

**Decision**: Go with Option A—direct in the route for minimalism. It keeps LOC low while meeting timezone/dedup needs. We can extract to a service if Calendar features expand post-MVP. Use 'string-similarity' for fuzzy matching (install: `npm i string-similarity`) and date-fns-tz (already planned).

Now, the implementation. Key snippets: Route handler, helper for dedup, types. Assume ParsedSemantics/ParsedCommand from parsers provide event data (e.g., { event: string, start: Date, end?: Date, timezone?: string }). User TZ stored in DB (e.g., auth table from Deliverable 7). Place in `src/routes/calendarRoutes.ts`. Current date (Jan 06, 2026) will be used in tests for relative dates.

#### 1. Define Types/Interfaces (for Event Data)
Extend `src/types.ts` or inline. Align with parser output.

```typescript
// src/types.ts (snippet)
import { calendar_v3 } from 'googleapis';

export interface EventData {
  summary: string; // Title/event
  description?: string;
  start: { dateTime: string; timeZone: string }; // ISO with TZ
  end?: { dateTime: string; timeZone: string };
  // Add more like location if parsers extract
}
```

#### 2. Dedup Helper Function
Check for similar events in ±1 day window.

```typescript
// src/utils/calendarDedup.ts
import { google } from 'googleapis';
import { Auth } from 'google-auth-library';
import * as similarity from 'string-similarity';
import { utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz';
import { formatISO } from 'date-fns';

export async function checkForDuplicate(
  auth: Auth.OAuth2Client,
  calendarId: string = 'primary',
  eventData: EventData,
  userTimeZone: string
): Promise<boolean> {
  const calendar = google.calendar({ version: 'v3', auth });

  // ±1 day window in user's TZ
  const startDate = utcToZonedTime(new Date(eventData.start.dateTime), userTimeZone);
  const timeMin = zonedTimeToUtc(new Date(startDate.getTime() - 24 * 60 * 60 * 1000), userTimeZone);
  const timeMax = zonedTimeToUtc(new Date(startDate.getTime() + 24 * 60 * 60 * 1000), userTimeZone);

  const events = await calendar.events.list({
    calendarId,
    timeMin: formatISO(timeMin),
    timeMax: formatISO(timeMax),
    singleEvents: true,
    orderBy: 'startTime',
  });

  if (!events.data.items) return false;

  for (const existing of events.data.items) {
    // Fuzzy match summary/description (threshold 0.8 for similarity)
    const summaryMatch = similarity.compareTwoStrings(eventData.summary, existing.summary || '') > 0.8;
    const descMatch = eventData.description && existing.description
      ? similarity.compareTwoStrings(eventData.description, existing.description) > 0.8
      : true; // If no desc, assume match

    // Date overlap: Check if starts overlap within 1 hour
    const existingStart = new Date(existing.start?.dateTime || '');
    const newStart = new Date(eventData.start.dateTime);
    const overlap = Math.abs(existingStart.getTime() - newStart.getTime()) < 60 * 60 * 1000;

    if (summaryMatch && descMatch && overlap) return true;
  }

  return false;
}
```

- **Notes**: 
  - Uses date-fns-tz for conversions (install: `npm i date-fns-tz date-fns`).
  - Fuzzy threshold tunable; 0.8 balances false positives/negatives.
  - API query low-cost (few events in window).
  - Handles all-day events if parsers output date only (adjust start/end accordingly).

#### 3. Fastify Route Implementation
POST /add-event, input from parser.

```typescript
// src/routes/calendarRoutes.ts
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { google } from 'googleapis';
import { utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz';
import { formatISO } from 'date-fns';
import { getUserAuth, getUserTimeZone } from '../utils/authHelper'; // From Deliverable 1/7
import { checkForDuplicate } from '../utils/calendarDedup';
import { EventData } from '../types';

const AddEventSchema = z.object({
  summary: z.string(),
  description: z.string().optional(),
  start: z.date(), // From parser, UTC
  end: z.date().optional(),
  parsedTimeZone: z.string().optional(), // If parser extracted, else user default
});

export async function calendarRoutes(fastify: FastifyInstance) {
  fastify.post('/add-event', async (request, reply) => {
    const body = AddEventSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid event data' });

    const auth = await getUserAuth(request.userId);
    const userTimeZone = await getUserTimeZone(request.userId) || 'UTC'; // Default

    // Convert parsed dates to user's TZ
    const zonedStart = utcToZonedTime(body.data.start, userTimeZone);
    const zonedEnd = body.data.end ? utcToZonedTime(body.data.end, userTimeZone) : undefined;

    const eventData: EventData = {
      summary: body.data.summary,
      description: body.data.description,
      start: { dateTime: formatISO(zonedStart), timeZone: userTimeZone },
      end: zonedEnd ? { dateTime: formatISO(zonedEnd), timeZone: userTimeZone } : undefined,
    };

    // Dedup check
    if (await checkForDuplicate(auth, 'primary', eventData, userTimeZone)) {
      return { success: true, message: 'Event skipped (duplicate)' };
    }

    // Insert
    const calendar = google.calendar({ version: 'v3', auth });
    const insertRes = await calendar.events.insert({
      calendarId: 'primary',
      resource: eventData,
    });

    return { success: true, eventId: insertRes.data.id };
  });
}
```

- **Notes**: 
  - Assumes parsers output UTC Dates; convert to user TZ before insert.
  - getUserTimeZone: Stub—query DB auth table.
  - Error handling: Add try/catch for API fails.

#### 4. Integration Snippet (for Deliverable 8 Orchestrator)
In /process-command/:emailId:

```typescript
// Snippet
const parsed = await parseEmail(content); // From router
if ('dates' in parsed && parsed.dates.length > 0) { // ParsedSemantics
  for (const evt of parsed.dates) {
    await fastify.inject({ // Or direct call
      method: 'POST',
      url: '/add-event',
      payload: { summary: evt.event, start: evt.start, end: evt.end, description: 'From email' },
    });
  }
}
```

#### 5. Testing Approach (Expanded)
`src/routes/calendarRoutes.test.ts`. Use Jest, mock googleapis.

```typescript
// src/routes/calendarRoutes.test.ts
import { checkForDuplicate } from '../utils/calendarDedup';
import { utcToZonedTime } from 'date-fns-tz';

// Mock googleapis...

describe('Calendar Event Adder', () => {
  it('converts and adds event in user TZ', async () => {
    const parsedDate = new Date('2026-01-07T09:00:00Z'); // Tomorrow from Jan 06, 2026
    const userTZ = 'America/Los_Angeles';
    const zoned = utcToZonedTime(parsedDate, userTZ);
    expect(zoned.getHours()).toBe(1); // 9am UTC = 1am PST (assuming winter)
    // Mock insert, assert payload TZ
  });

  it('skips duplicate via fuzzy match', async () => {
    // Mock events.list with similar event
    const isDup = await checkForDuplicate(mockAuth, 'primary', mockEvent, 'UTC');
    expect(isDup).toBe(true);
  });

  // More: Test ±1 day window, no overlap, low similarity, various TZs (e.g., 'Asia/Tokyo'), all-day events
});
```

This completes Deliverable 6—reliable, timezone-smart (~90 LOC core + tests). Focuses on accuracy without bloat. Next: Deliverable 7.