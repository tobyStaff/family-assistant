### Detailed Implementation for Deliverable 9: Daily Summary (Robust Cron)

As the lead web engineer, let's flesh out Deliverable 9. This module handles sending daily email digests summarizing upcoming TODOs and calendar events for the next 24 hours, ensuring reliability without risking server crashes. It builds on the DB (Deliverable 7) and Calendar API (Deliverable 6), using a cron job for scheduling. We'll keep it modular, integrating with Fastify via a plugin, and focus on simple HTML formatting with plain text fallback for broad email client compatibility. TypeScript is ideal for type-safe queries and email generation, minimizing errors. If we needed advanced scheduling or distributed crons (e.g., for high-scale), I'd recommend a Python microservice with APScheduler and SMTP lib like smtplib for more robust email handling, but that's overkill here—Node's ecosystem suffices for our MVP's low activity.

Before implementation, let's evaluate 2-3 options for the cron and summary setup, as trade-offs guide good engineering:

1. **Option A: Fastify-Cron Plugin with Inline Logic (Chosen in Plan)**  
   - Register fastify-cron, define a job that queries DB/Calendar, generates email, and sends via Google Gmail API (reuse auth from Deliverable 1). Wrap in try/catch for safety.  
   - Pros: Minimal deps (fastify-cron ~100KB), integrates seamlessly with our Fastify app, low LOC (~50-80). Handles per-user summaries in a loop.  
   - Cons: Cron runs in-process—if app restarts often, jobs might miss; no built-in persistence for missed runs.  
   - Trade-off: Perfect for MVP—1-2 days, reliable on stable Droplet. Aligns with plan's robustness via try/catch.

2. **Option B: Node-Cron Standalone with Event Emitter**  
   - Use node-cron lib separately, emit events to Fastify handlers for processing. This decouples scheduling from the app.  
   - Pros: Lighter (~50KB), more flexible for testing (mock cron), easier to run outside Docker if needed.  
   - Cons: Adds manual integration (~20-30 extra LOC), potential event race conditions. Less "plug-and-play" than fastify-cron.  
   - Trade-off: Good for isolation, but increases complexity without much gain. Skip to keep monolithic simplicity.

3. **Option C: External Service like AWS Lambda or Heroku Scheduler**  
   - Offload cron to a cloud scheduler, hitting our /daily-summary endpoint via webhook.  
   - Pros: High reliability (no in-process risks), scales independently, easy backups.  
   - Cons: Adds external dep/cost (e.g., $0.25/mo for Lambda), more setup (API keys, security), deviates from $5/mo Droplet goal. Increases latency.  
   - Trade-off: Better for production, but overengineers MVP. Not worth the ops overhead—stick in-app.

**Decision**: Proceed with Option A—fastify-cron in TS. It minimizes LOC and bugs while meeting the plan's safety and reliability needs. Easy to test manually, and try/catch prevents crashes. We can migrate to external if uptime issues arise post-MVP.

Now, the implementation. Key snippets: Cron registration, query helpers, email generator. Place in `src/plugins/dailySummary.ts`. Install: `npm i fastify-cron`. Reuse googleapis for sending (Gmail API avoids SMTP setup).

#### 1. Define Types (for Summary Data)
Add to `src/types.ts`.

```typescript
// src/types.ts (snippet)
export interface DailySummary {
  todos: Array<{ description: string; dueDate?: Date }>;
  events: Array<{ summary: string; start: Date; end?: Date }>;
}
```

#### 2. Query Helpers
Fetch next 24h data per user.

```typescript
// src/utils/summaryQueries.ts
import db from '../db/db'; // Deliverable 7
import { google } from 'googleapis';
import { Auth } from 'google-auth-library';
import { formatISO, addHours } from 'date-fns';
import { getUserAuth, getAllUserIds } from '../utils/authHelper'; // Extended for all users

const todoStmt = db.prepare(`
  SELECT description, due_date FROM todos
  WHERE user_id = ? AND status = 'pending'
  AND due_date BETWEEN ? AND ?
`);

export function getUpcomingTodos(userId: string): DailySummary['todos'] {
  const now = new Date();
  const next24h = addHours(now, 24);
  return todoStmt.all(userId, formatISO(now), formatISO(next24h)).map(row => ({
    description: row.description,
    dueDate: row.due_date ? new Date(row.due_date) : undefined,
  }));
}

export async function getUpcomingEvents(auth: Auth.OAuth2Client): Promise<DailySummary['events']> {
  const calendar = google.calendar({ version: 'v3', auth });
  const now = new Date();
  const next24h = addHours(now, 24);

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: formatISO(now),
    timeMax: formatISO(next24h),
    singleEvents: true,
    orderBy: 'startTime',
  });

  return (res.data.items || []).map(evt => ({
    summary: evt.summary || '',
    start: new Date(evt.start?.dateTime || evt.start?.date || ''),
    end: evt.end ? new Date(evt.end.dateTime || evt.end.date || '') : undefined,
  }));
}

export async function generateSummary(userId: string): Promise<DailySummary> {
  const auth = await getUserAuth(userId);
  return {
    todos: getUpcomingTodos(userId),
    events: await getUpcomingEvents(auth),
  };
}
```

- **Notes**: 
  - Uses date-fns for date math (already installed).
  - Multi-tenant: Loop over users from auth table (implement getAllUserIds as SELECT user_id FROM auth).
  - Calendar: Reuses Deliverable 6 logic.

#### 3. Email Generator and Sender
Simple HTML with text fallback.

```typescript
// src/utils/emailSender.ts
import { google } from 'googleapis';
import { Auth } from 'google-auth-library';
import { DailySummary } from '../types';

export async function sendDailySummary(auth: Auth.OAuth2Client, summary: DailySummary, userEmail: string): Promise<void> {
  const gmail = google.gmail({ version: 'v1', auth });

  const html = `
    <h1>Daily Inbox Summary</h1>
    <h2>Upcoming TODOs:</h2>
    <ul>${summary.todos.map(t => `<li>${t.description} ${t.dueDate ? `(Due: ${t.dueDate.toLocaleString()})` : ''}</li>`).join('')}</ul>
    <h2>Upcoming Events:</h2>
    <ul>${summary.events.map(e => `<li>${e.summary} (Start: ${e.start.toLocaleString()}${e.end ? ` - End: ${e.end.toLocaleString()}` : ''})</li>`).join('')}</ul>
  `;

  const text = `
    Daily Inbox Summary

    Upcoming TODOs:
    ${summary.todos.map(t => `- ${t.description} ${t.dueDate ? `(Due: ${t.dueDate.toLocaleString()})` : ''}`).join('\n')}

    Upcoming Events:
    ${summary.events.map(e => `- ${e.summary} (Start: ${e.start.toLocaleString()}${e.end ? ` - End: ${e.end.toLocaleString()}` : ''})`).join('\n')}
  `;

  const message = [
    `To: ${userEmail}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    'Subject: Daily Inbox Summary',
    '',
    html,
    '--fallback',
    'Content-Type: text/plain; charset=utf-8',
    '',
    text,
  ].join('\r\n');

  const encoded = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encoded },
  });
}
```

- **Notes**: 
  - MIME multipart for HTML/text.
  - userEmail: From auth or DB (add to auth table if needed).
  - Reuse auth for sending (self-email via Gmail API).

#### 4. Cron Plugin Registration
In Fastify.

```typescript
// src/plugins/dailySummary.ts
import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import fastifyCron from 'fastify-cron';
import { generateSummary } from '../utils/summaryQueries';
import { sendDailySummary } from '../utils/emailSender';
import { getAllUserIds, getUserEmail } from '../utils/authHelper'; // Stubs

export default fp(async (fastify: FastifyInstance) => {
  await fastify.register(fastifyCron);

  fastify.cron.createJob({
    name: 'daily-summary',
    cronTime: '0 8 * * *', // 8 AM daily (UTC; adjust for TZ)
    onTick: async () => {
      try {
        const userIds = await getAllUserIds();
        for (const userId of userIds) {
          const summary = await generateSummary(userId);
          if (summary.todos.length || summary.events.length) {
            const auth = await getUserAuth(userId);
            const email = await getUserEmail(userId);
            await sendDailySummary(auth, summary, email);
          }
        }
      } catch (error) {
        console.error('Cron error:', error); // Log, don't crash
      }
    },
  });

  fastify.cron.startJob('daily-summary');
});
```

- **Notes**: 
  - try/catch: Ensures cron failure isolates.
  - Cron: Daily; test with manual trigger.
  - Register in app.ts: `await app.register(dailySummaryPlugin);`

#### 5. Integration Snippet (Overall App)
In `src/app.ts`: Import and register the plugin.

#### 6. Testing Approach (Expanded)
`src/plugins/dailySummary.test.ts`. Jest with mocks.

```typescript
// src/plugins/dailySummary.test.ts
import { generateSummary } from '../utils/summaryQueries';
import { sendDailySummary } from '../utils/emailSender';

describe('Daily Summary', () => {
  it('generates and formats summary', async () => {
    // Mock DB/API
    const summary = await generateSummary('testUser');
    expect(summary).toHaveProperty('todos');
    expect(summary).toHaveProperty('events');
  });

  it('sends email with HTML/text', async () => {
    // Mock auth/gmail
    await sendDailySummary(mockAuth, mockSummary, 'test@email.com');
    // Assert message format
  });

  it('manual cron trigger', async () => {
    // Use fastify.cron.getJob('daily-summary').fireOnTick()
    // Assert no crash on error (try/catch)
  });
});
```

This wraps Deliverable 9—reliable, minimal (~70 LOC core + tests). Daily digests enhance usability without complexity. On to 10 if ready.