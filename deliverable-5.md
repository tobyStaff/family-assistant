### Detailed Implementation for Deliverable 5: Attachment Saver (Streaming)

As the lead web engineer, let's detail Deliverable 5. This module handles saving Gmail attachments to Google Drive using streams to avoid loading large files into memory, preventing OOM crashes on our low-spec Digital Ocean Droplet. It's critical for stability, especially with attachments up to hundreds of MB. We'll integrate it as a Fastify route, leveraging Node.js streams for zero-copy piping. TypeScript is ideal here for type-safe API clients (googleapis) and error handling, keeping everything consistent with the monolithic app. If we needed advanced file processing (e.g., virus scanning), I'd suggest a Python microservice with libraries like clamd, but that's beyond MVP scope—no analysis/extraction per the plan.

Before coding, evaluate 2-3 options for the streaming approach, as trade-offs matter:

1. **Option A: Native Node.js Streams with googleapis (Chosen in Plan)**  
   - Use Readable from Gmail API, pipe to Writable for Drive via PassThrough. Handle directly in the route handler.  
   - Pros: Minimal deps (just googleapis), zero RAM overhead, full control over errors/retries. Pure TS, low LOC (~50-80).  
   - Cons: Manual stream management (e.g., error propagation), tied to Google SDKs.  
   - Trade-off: Best for MVP—simple, performant on micro-VM. Aligns with plan's "near-zero RAM footprint."

2. **Option B: Use Busboy for Multipart + Streams**  
   - If attachments were uploaded via our API (future), parse with busboy, then stream to Drive. For now, adapt for Gmail fetches.  
   - Pros: Handles multipart efficiently if expanding to user uploads; good for resumable uploads.  
   - Cons: Adds dep (busboy), unnecessary complexity for direct Gmail-to-Drive pipe (over 100 LOC). Not needed since Gmail API provides streams natively.  
   - Trade-off: Useful for scalability, but bloats MVP. Skip to keep LOC minimal.

3. **Option C: Buffer in Memory with Limits**  
   - Fetch attachment as Buffer, then upload—simple but risky. Add heap limits via --max-old-space-size.  
   - Pros: Easier to implement/debug (no stream events).  
   - Cons: Defeats the goal (OOM risk on large files), violates plan's stability focus. Higher latency.  
   - Trade-off: Quick hack for tiny attachments, but unacceptable for production MVP. Avoid.

**Decision**: Stick with Option A—native streams in TS. It minimizes bug surface, ensures portability in Docker, and meets the plan's streaming mandate. Easy to test with large files without crashing the process.

Now, the implementation. Key snippets: The route in Fastify, stream helper. Place in `src/routes/attachmentSaver.ts` or integrate into main app.ts. Assumes auth from Deliverable 1 (OAuth client). Install: Already have googleapis.

#### 1. Define Types/Interfaces (for Safety)
Add to `src/types.ts` or inline.

```typescript
// src/types.ts (snippet)
import { drive_v3, gmail_v1 } from 'googleapis';

export interface AttachmentSaveParams {
  emailId: string;
  attachmentId: string; // From email metadata
  fileName: string; // Extracted or default
}
```

#### 2. Implement the Stream Saver Function
Core logic: Fetch stream from Gmail, pipe to Drive.

```typescript
// src/utils/attachmentSaver.ts
import { google } from 'googleapis';
import { PassThrough } from 'stream';
import { Auth } from 'google-auth-library'; // Assuming from Deliverable 1

export async function saveAttachmentToDrive(
  auth: Auth.OAuth2Client,
  params: AttachmentSaveParams
): Promise<string | null> { // Returns Drive file ID or null on error
  const gmail = google.gmail({ version: 'v1', auth });
  const drive = google.drive({ version: 'v3', auth });

  try {
    // Get attachment stream
    const attachmentRes = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: params.emailId,
      id: params.attachmentId,
      alt: 'media', // Streams the binary
    });

    if (!attachmentRes.data || !attachmentRes.data.body) {
      throw new Error('No attachment data');
    }

    // Use PassThrough to pipe without buffering
    const passThrough = new PassThrough();
    (attachmentRes.data.body as NodeJS.ReadableStream).pipe(passThrough); // Type cast if needed

    // Upload to Drive
    const fileMetadata = { name: params.fileName };
    const media = { mimeType: 'application/octet-stream', body: passThrough };

    const driveRes = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: 'id',
    });

    return driveRes.data.id || null;
  } catch (error) {
    console.error('Attachment save error:', error);
    return null;
  }
}
```

- **Notes**: 
  - No full buffering—streams handle chunking.
  - Auth injected for multi-tenancy (user-specific tokens from DB).
  - MimeType generic; can detect via magic bytes if needed, but minimal for MVP.
  - Error handling: Logs, returns null—caller (route) can retry or respond 500.

#### 3. Fastify Route Integration
Add to `src/app.ts` or dedicated routes file. Use Zod for param validation.

```typescript
// src/routes/attachmentRoutes.ts (or in app.ts)
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { saveAttachmentToDrive } from '../utils/attachmentSaver';
import { getUserAuth } from '../utils/authHelper'; // From Deliverable 1

const SaveAttachmentSchema = z.object({
  emailId: z.string(),
  attachmentId: z.string(), // Pass as query or body; here assuming params + query
  fileName: z.string(),
});

export async function attachmentRoutes(fastify: FastifyInstance) {
  fastify.post('/save-attachment/:emailId', async (request, reply) => {
    const params = SaveAttachmentSchema.safeParse({ ...request.params, ...request.body });

    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid params' });
    }

    const auth = await getUserAuth(request.userId); // Assuming JWT or session for user_id
    const fileId = await saveAttachmentToDrive(auth, params.data);

    if (!fileId) {
      return reply.code(500).send({ error: 'Save failed' });
    }

    return { success: true, fileId };
  });
}
```

- **Notes**: 
  - Route: POST for safety (though idempotent). :emailId in path, others in body.
  - Integrates with Deliverable 8's orchestrator: Call after parsing email metadata.
  - For multi-attachments: Loop over IDs in orchestrator.

#### 4. Integration Snippet (for Deliverable 8 Orchestrator)
In /process-command/:emailId handler:

```typescript
// Snippet from src/routes/commandProcessor.ts
// After fetching email metadata with attachments
for (const att of email.attachments) {
  const savedId = await saveAttachmentToDrive(auth, {
    emailId,
    attachmentId: att.id,
    fileName: att.filename || 'attachment',
  });
  // Store savedId in DB or log
}
```

#### 5. Testing Approach (Expanded)
Unit: Jest for function. E2E: Large file test.

```typescript
// src/utils/attachmentSaver.test.ts
import { saveAttachmentToDrive } from './attachmentSaver';
import { google } from 'googleapis';

// Mock googleapis
jest.mock('googleapis');

describe('saveAttachmentToDrive', () => {
  it('pipes stream successfully', async () => {
    // Mock auth, responses
    const mockAuth = {} as any;
    const mockGmailGet = jest.fn().mockResolvedValue({ data: { body: new PassThrough() } });
    const mockDriveCreate = jest.fn().mockResolvedValue({ data: { id: 'file123' } });

    (google.gmail as jest.Mock).mockReturnValue({ users: { messages: { attachments: { get: mockGmailGet } } } });
    (google.drive as jest.Mock).mockReturnValue({ files: { create: mockDriveCreate } });

    const result = await saveAttachmentToDrive(mockAuth, { emailId: '123', attachmentId: 'att1', fileName: 'test.pdf' });
    expect(result).toBe('file123');
    expect(mockGmailGet).toHaveBeenCalled();
    expect(mockDriveCreate).toHaveBeenCalled();
  });

  // Error cases: No body, API fail
});

// E2E Test: Use a script to send email with 500MB attachment via Gmail API mock or local setup.
// Run on low-mem Docker (e.g., --memory=256m), monitor heap with fastify-metrics.
// Assert no crash, file exists in Drive.
```

This wraps Deliverable 5—stable, minimal (~70 LOC core + tests). Streams ensure it scales on cheap hardware. Ready for Deliverable 6.