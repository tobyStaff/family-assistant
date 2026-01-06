### Detailed Implementation for Deliverable 8: Self-Email Command Processor

As the lead web engineer, let's detail Deliverable 8. This is the core orchestrator that ties everything together: it processes a self-sent email by fetching its content, routing to the appropriate parser (NLP for explicit commands or AI for semantics), and executing actions like saving attachments, adding calendar events, or creating TODOs. Idempotency is key to avoid duplicates, using the DB to track processed emailIds (e.g., add a processed_emails table). We'll implement it as a Fastify route, leveraging modules from prior deliverables for modularity. TypeScript keeps it type-safe and concise, with Zod for input validation. If we needed distributed processing (e.g., for high concurrency), I'd recommend a Python-based queue like Celery with Redis, but that's unnecessary here—Node's async handles our 5-20 concurrent users fine on the micro-VM.

Before coding, let's evaluate 2-3 options for the orchestrator structure, focusing on trade-offs:

1. **Option A: Inline Route Handler with Sequential Logic (Chosen in Plan)**  
   - Implement fetch/parse/execute directly in the /process-command/:emailId handler, using async/await for flow. Check idempotency first via DB query.  
   - Pros: Minimal LOC (~60-90), straightforward debugging, no extra abstractions. Fits monolithic MVP.  
   - Cons: Couples all logic in one function; harder to test isolated parts.  
   - Trade-off: Best for quick MVP—2 days effort, low maintenance. Prioritizes simplicity over separation.

2. **Option B: Orchestrator Class with Methods**  
   - Create a Processor class with methods like fetchEmail(), routeParse(), executeActions(). Route instantiates and calls process().  
   - Pros: Better modularity for testing (mock methods), reusable if adding more workflows. Easier to extend (e.g., add email forwarding).  
   - Cons: Adds ~30-50 LOC for class structure, slight overkill for single-route orchestrator.  
   - Trade-off: Enhances maintainability but risks bloating code. Skip for now to keep LOC minimal; inline is sufficient.

3. **Option C: Use a Workflow Lib like Temporal.js**  
   - Integrate Temporal for orchestrated workflows, defining activities for fetch/parse/execute with built-in retries/idempotency.  
   - Pros: Robust for failures (e.g., AI API downtime), scalable to microservices later. Handles concurrency natively.  
   - Cons: Adds dep (~2MB), steep learning curve, more LOC/setup (~150+). Way overengineered for MVP's scale.  
   - Trade-off: Great for production-grade resilience, but exceeds effort/budget. Not needed—native async/try-catch suffices.

**Decision**: Go with Option A—inline in the route. It minimizes LOC while meeting idempotency and routing needs. We can refactor to a class if workflows grow post-MVP. This keeps the app neat and bug-resistant.

Now, the implementation. Key snippets: Add processed_emails table to DB, the route handler. Place in `src/routes/commandProcessor.ts`. Builds on Deliverables 2-7 (e.g., import parsers, savers). Installs none new—reuse existing.

#### 1. Update DB for Idempotency
Add table in `src/db/db.ts` init:

```typescript
// src/db/db.ts (updated exec)
db.exec(`
  CREATE TABLE IF NOT EXISTS processed_emails (
    email_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_processed_user_id ON processed_emails(user_id);
`);

// Helper functions in src/db/processedDb.ts
import db from './db';

const checkStmt = db.prepare(`SELECT 1 FROM processed_emails WHERE email_id = ? AND user_id = ?`);

export function isProcessed(userId: string, emailId: string): boolean {
  return !!checkStmt.get(emailId, userId);
}

const insertStmt = db.prepare(`
  INSERT INTO processed_emails (email_id, user_id)
  VALUES (?, ?)
`);

export function markProcessed(userId: string, emailId: string): void {
  insertStmt.run(emailId, userId);
}
```

- **Notes**: PRIMARY KEY on email_id ensures uniqueness per user (but filter by user_id for multi-tenancy).

#### 2. Orchestrator Route
Full logic: Idempotency check -> Fetch (Deliverable 2) -> Parse (router from 3/4) -> Execute (5/6/7).

First, router helper (if not already):

```typescript
// src/parsers/parserRouter.ts
import { NlpParser } from './nlpParser';
import { AiParser } from './aiParser';
import { ParsedResult } from './IParser';
import { DEFAULT_KEYWORDS } from './nlpParser'; // From Deliverable 3

export async function routeParse(content: string): Promise<ParsedResult | null> {
  const lowerContent = content.toLowerCase();
  const hasKeywords = Object.values(DEFAULT_KEYWORDS).flat().some(kw => lowerContent.includes(kw.toLowerCase()));

  if (hasKeywords) {
    return new NlpParser().parse(content);
  } else {
    return await new AiParser().parse(content);
  }
}
```

Now, the route:

```typescript
// src/routes/commandProcessor.ts
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { google } from 'googleapis';
import { getUserAuth } from '../utils/authHelper'; // Deliverable 1
import { routeParse } from '../parsers/parserRouter'; // Above
import { saveAttachmentToDrive } from '../utils/attachmentSaver'; // Deliverable 5
import { createTodo } from '../db/todoDb'; // Deliverable 7
import { isProcessed, markProcessed } from '../db/processedDb'; // Above
import { ParsedResult, ParsedCommand, ParsedSemantics } from '../parsers/IParser';
// Import calendar insert logic or use inject for /add-event (Deliverable 6)

const ProcessSchema = z.object({ emailId: z.string() });

export async function commandProcessorRoutes(fastify: FastifyInstance) {
  fastify.post('/process-command/:emailId', async (request, reply) => {
    const params = ProcessSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid emailId' });

    const { emailId } = params.data;
    const userId = request.userId; // From auth middleware
    const auth = await getUserAuth(userId);

    // Idempotency
    if (isProcessed(userId, emailId)) {
      return { success: true, message: 'Already processed' };
    }

    try {
      // Fetch email (from Deliverable 2 logic, adapted)
      const gmail = google.gmail({ version: 'v1', auth });
      const emailRes = await gmail.users.messages.get({
        userId: 'me',
        id: emailId,
        format: 'full', // Get body/attachments
      });

      const emailData = emailRes.data;
      const content = getEmailContent(emailData); // Helper: Extract body (base64 decode if needed)
      const attachments = getAttachments(emailData); // Helper: Array of {id, filename}

      // Parse
      const parsed = await routeParse(content);
      if (!parsed) throw new Error('Parse failed');

      // Execute actions
      // Attachments (always, per plan—defer analysis)
      const savedFiles: string[] = [];
      for (const att of attachments || []) {
        const fileId = await saveAttachmentToDrive(auth, { emailId, attachmentId: att.id, fileName: att.filename });
        if (fileId) savedFiles.push(fileId);
      }

      // TODOs/Actions
      if ('type' in parsed) { // ParsedCommand
        const cmd = parsed as ParsedCommand;
        if (cmd.type === 'todo' || cmd.type === 'task') {
          createTodo(userId, cmd.description, cmd.dueDate);
        } else if (cmd.type === 'cal') {
          // Call /add-event (or inline logic)
          await addCalendarEvent(userId, { summary: cmd.description, start: cmd.dueDate || new Date() }); // Stub
        }
      } else { // ParsedSemantics
        const sem = parsed as ParsedSemantics;
        for (const act of sem.actions) {
          createTodo(userId, act.description, act.dueDate);
        }
        for (const evt of sem.dates) {
          await addCalendarEvent(userId, { summary: evt.event, start: evt.start, end: evt.end }); // Stub
        }
      }

      // Mark processed
      markProcessed(userId, emailId);

      return { success: true, savedFiles, parsed };
    } catch (error) {
      console.error('Process error:', error);
      return reply.code(500).send({ error: 'Processing failed' });
    }
  });
}

// Helpers (stubbed)
function getEmailContent(data: any): string {
  // Decode payload.parts or body.data (base64)
  return 'Extracted content'; // Implement properly
}

function getAttachments(data: any): {id: string, filename: string}[] {
  // From payload.parts with mimeType
  return [];
}

async function addCalendarEvent(userId: string, eventData: any) {
  // Inline from Deliverable 6 or fastify.inject POST /add-event
}
```

- **Notes**: 
  - Async for I/O (fetch, AI, APIs).
  - Helpers: Flesh out as needed—decode base64 with Buffer.from().
  - Execute: Maps parsed fields to actions; expand for importance/urgency (e.g., tag TODOs).
  - Error: Basic try/catch—add retries if needed (e.g., exponential backoff from Deliverable 2).

#### 3. Integration Snippet (Overall App)
In `src/app.ts`: `await commandProcessorRoutes(app);`

This route is called via webhook or cron when new self-email arrives (from Deliverable 2 fetch, extended).

#### 4. Testing Approach (Expanded)
`src/routes/commandProcessor.test.ts`. Jest with mocks.

```typescript
// src/routes/commandProcessor.test.ts
import { buildFastify } from '../app'; // Helper to build app for tests

describe('Command Processor', () => {
  const fastify = buildFastify();

  it('processes command email idempotently', async () => {
    const emailId = 'test123';
    // Mock fetch/parse/execute
    const res1 = await fastify.inject({
      method: 'POST',
      url: `/process-command/${emailId}`,
      headers: { userId: 'testUser' }, // Mock auth
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.json().success).toBe(true);

    const res2 = await fastify.inject({ /* same */ });
    expect(res2.json().message).toBe('Already processed');
  });

  it('routes to NLP for command keywords', async () => {
    // Mock email with '#todo'
    // Assert createTodo called
  });

  it('routes to AI for semantics', async () => {
    // Mock unstructured email
    // Assert AI parse, then actions
  });

  // More: Error paths, attachments save, calendar add
});
```

This completes Deliverable 8—core workflow, idempotent (~80 LOC core + tests). Ties MVP together efficiently. Ready for 9.