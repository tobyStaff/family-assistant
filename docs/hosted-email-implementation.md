# Hosted Email Implementation Plan

## Overview

Add hosted email as an alternative to Gmail OAuth. Users receive a custom forwarding address (e.g., `toby@inbox.getfamilyassistant.com`) and forward school emails to it. This eliminates the need for granting Gmail API access.

## Configuration

| Setting | Value |
|---------|-------|
| Email subdomain | `inbox.getfamilyassistant.com` |
| Format | `{user-chosen}@inbox.getfamilyassistant.com` |
| Mode | One source per user (Gmail OR Hosted) |
| Attachments | Store originals (reuse existing storage) |

## Architecture

```
Current Flow (Gmail):
┌─────────┐    OAuth    ┌─────────────┐    fetch    ┌────────────┐
│  Gmail  │ ──────────► │ Gmail API   │ ──────────► │ emails DB  │
└─────────┘             └─────────────┘             └────────────┘

New Flow (Hosted):
┌─────────┐  forward   ┌─────────┐  store   ┌────────┐  invoke  ┌────────┐
│  User's │ ─────────► │ AWS SES │ ───────► │   S3   │ ───────► │ Lambda │
│  Email  │            └─────────┘          └────────┘          └────────┘
└─────────┘                                                          │
                                                                     │ POST
                                                                     ▼
┌────────────┐    store    ┌─────────────────────────────────────────────┐
│ emails DB  │ ◄────────── │ POST /api/email/inbound (webhook handler)   │
└────────────┘             └─────────────────────────────────────────────┘

Both flows converge at emails table → existing analysis pipeline unchanged
```

## Cost Estimate

| Volume | Monthly Cost | Notes |
|--------|--------------|-------|
| < 1,000 emails | ~$0 | AWS free tier |
| 10,000 emails | ~$1-2 | S3 + Lambda |
| 100,000 emails | ~$10-15 | Still minimal |

Plus domain MX setup: Free (using existing domain)

---

## Phase 1: AWS Account & Infrastructure

### 1.1 Create AWS Account
- Sign up at https://aws.amazon.com
- Enable MFA on root account
- Create IAM user for programmatic access

### 1.2 Verify Domain in SES
1. Go to SES Console → Verified Identities
2. Add domain: `inbox.getfamilyassistant.com`
3. Add DNS records to your domain registrar:
   ```
   Type: TXT
   Name: _amazonses.inbox
   Value: (provided by AWS)
   ```

### 1.3 Configure MX Records
Add to DNS for `inbox.getfamilyassistant.com`:
```
Type: MX
Name: inbox
Value: 10 inbound-smtp.us-east-1.amazonaws.com
TTL: 3600
```

Note: Use the correct region endpoint for your SES region.

### 1.4 Create S3 Bucket
```
Bucket name: getfamilyassistant-inbound-emails
Region: us-east-1 (same as SES)
Block public access: Yes (all)
Versioning: Disabled
Lifecycle rule: Delete after 7 days (emails stored in app DB)
```

Bucket policy (allow SES to write):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ses.amazonaws.com"
      },
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::getfamilyassistant-inbound-emails/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceAccount": "YOUR_ACCOUNT_ID"
        }
      }
    }
  ]
}
```

### 1.5 Create Lambda Function

**Function settings:**
- Name: `getfamilyassistant-email-processor`
- Runtime: Node.js 20.x
- Architecture: arm64 (cheaper)
- Memory: 256 MB
- Timeout: 30 seconds

**Environment variables:**
```
WEBHOOK_URL=https://getfamilyassistant.com/api/email/inbound
WEBHOOK_SECRET=<generate-secure-random-string>
EMAIL_BUCKET=getfamilyassistant-inbound-emails
```

**IAM Role permissions:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::getfamilyassistant-inbound-emails/*"
    },
    {
      "Effect": "Allow",
      "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

### 1.6 Create SES Receipt Rule Set

1. Go to SES Console → Email receiving → Rule sets
2. Create rule set: `getfamilyassistant-inbound`
3. Create rule:
   - Name: `catch-all`
   - Recipients: (leave empty for catch-all on verified domain)
   - Actions:
     1. S3: Store in `getfamilyassistant-inbound-emails`
     2. Lambda: Invoke `getfamilyassistant-email-processor`
4. Set as active rule set

---

## Phase 2: Database Schema

### Migration 10: Hosted Email Support

```typescript
// In src/db/db.ts, add after Migration 9

if (version < 10) {
  console.log('Running migration 10: Adding hosted email support');

  db.transaction(() => {
    // 1. Add hosted email alias to users (user-chosen, unique)
    db.exec(`ALTER TABLE users ADD COLUMN hosted_email_alias TEXT UNIQUE;`);

    // 2. Add email source preference to settings
    db.exec(`ALTER TABLE user_settings ADD COLUMN email_source TEXT DEFAULT 'gmail' CHECK(email_source IN ('gmail', 'hosted'));`);

    // 3. Add source tracking to emails table
    db.exec(`ALTER TABLE emails ADD COLUMN source_type TEXT DEFAULT 'gmail' CHECK(source_type IN ('gmail', 'hosted'));`);
    db.exec(`ALTER TABLE emails ADD COLUMN source_message_id TEXT;`);

    // 4. Backfill source_message_id from gmail_message_id for existing emails
    db.exec(`UPDATE emails SET source_message_id = gmail_message_id WHERE source_type = 'gmail';`);

    // 5. Create index for source-based queries
    db.exec(`CREATE INDEX IF NOT EXISTS idx_emails_source ON emails(source_type);`);

    // Record migration
    db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
      10,
      'Add hosted email support with user-chosen aliases and email source tracking'
    );
  })();

  console.log('Migration 10 completed');
}
```

### Updated Interfaces

```typescript
// src/db/userDb.ts - extend User interface
interface User {
  user_id: string;
  email: string;
  name?: string;
  picture_url?: string;
  roles: Role[];
  hosted_email_alias?: string;  // NEW: e.g., "toby"
  created_at: Date;
  updated_at: Date;
}

// src/db/settingsDb.ts - extend Settings interface
interface UserSettings {
  user_id: string;
  summary_email_recipients: string[];
  summary_enabled: boolean;
  summary_time_utc: number;
  timezone: string;
  email_source: 'gmail' | 'hosted';  // NEW
}

// src/db/emailDb.ts - extend Email interface
interface StoredEmail {
  // ... existing fields ...
  source_type: 'gmail' | 'hosted';  // NEW
  source_message_id: string;         // NEW: gmail_message_id or SES messageId
}
```

---

## Phase 3: Lambda Function Code

### Project Structure
```
lambda/
├── package.json
├── tsconfig.json
└── src/
    └── index.ts
```

### package.json
```json
{
  "name": "email-processor-lambda",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "package": "npm run build && cd dist && zip -r ../function.zip ."
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.0.0",
    "mailparser": "^3.6.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

### src/index.ts
```typescript
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { simpleParser, ParsedMail, Attachment } from 'mailparser';

const s3 = new S3Client({});

interface SESMailRecord {
  eventSource: 'aws:ses';
  ses: {
    mail: {
      messageId: string;
      source: string;
      destination: string[];
      timestamp: string;
      commonHeaders: {
        from: string[];
        to: string[];
        subject: string;
        date: string;
      };
    };
    receipt: {
      recipients: string[];
      spamVerdict: { status: string };
      virusVerdict: { status: string };
    };
  };
}

interface SESEvent {
  Records: SESMailRecord[];
}

interface InboundEmailPayload {
  messageId: string;
  recipient: string;
  from: string;
  fromName?: string;
  subject: string;
  textBody?: string;
  htmlBody?: string;
  date: string;
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
    content: string; // base64
  }>;
  spamVerdict: string;
  virusVerdict: string;
}

export const handler = async (event: SESEvent): Promise<{ status: string }> => {
  const webhookUrl = process.env.WEBHOOK_URL!;
  const webhookSecret = process.env.WEBHOOK_SECRET!;
  const bucket = process.env.EMAIL_BUCKET!;

  for (const record of event.Records) {
    const { mail, receipt } = record.ses;

    // Skip spam/virus
    if (receipt.spamVerdict.status === 'FAIL' || receipt.virusVerdict.status === 'FAIL') {
      console.log(`Skipping spam/virus email: ${mail.messageId}`);
      continue;
    }

    try {
      // Fetch raw email from S3
      const { Body } = await s3.send(new GetObjectCommand({
        Bucket: bucket,
        Key: mail.messageId,
      }));

      if (!Body) {
        console.error(`No body for message ${mail.messageId}`);
        continue;
      }

      // Parse email
      const bodyBytes = await Body.transformToByteArray();
      const parsed: ParsedMail = await simpleParser(Buffer.from(bodyBytes));

      // Extract first recipient (the alias@inbox.getfamilyassistant.com)
      const recipient = mail.destination[0];

      // Build payload
      const payload: InboundEmailPayload = {
        messageId: mail.messageId,
        recipient,
        from: parsed.from?.value[0]?.address || mail.source,
        fromName: parsed.from?.value[0]?.name,
        subject: parsed.subject || '(no subject)',
        textBody: parsed.text,
        htmlBody: parsed.html || undefined,
        date: parsed.date?.toISOString() || mail.timestamp,
        attachments: (parsed.attachments || []).map((att: Attachment) => ({
          filename: att.filename || 'unnamed',
          contentType: att.contentType,
          size: att.size,
          content: att.content.toString('base64'),
        })),
        spamVerdict: receipt.spamVerdict.status,
        virusVerdict: receipt.virusVerdict.status,
      };

      // Call webhook
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': webhookSecret,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Webhook failed for ${mail.messageId}: ${response.status} ${errorText}`);
      } else {
        console.log(`Processed email ${mail.messageId} for ${recipient}`);
      }
    } catch (error) {
      console.error(`Error processing ${mail.messageId}:`, error);
      throw error; // Let Lambda retry
    }
  }

  return { status: 'ok' };
};
```

---

## Phase 4: Webhook Handler

### New Route File: src/routes/emailInboundRoutes.ts

```typescript
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getUserByHostedAlias, createHostedEmail } from '../db/hostedEmailDb.js';
import { storeDownloadedAttachments } from '../utils/attachmentExtractor.js';

const WEBHOOK_SECRET = process.env.HOSTED_EMAIL_WEBHOOK_SECRET;
const EMAIL_DOMAIN = 'inbox.getfamilyassistant.com';

const InboundEmailSchema = z.object({
  messageId: z.string(),
  recipient: z.string().email(),
  from: z.string(),
  fromName: z.string().optional(),
  subject: z.string(),
  textBody: z.string().optional(),
  htmlBody: z.string().optional(),
  date: z.string(),
  attachments: z.array(z.object({
    filename: z.string(),
    contentType: z.string(),
    size: z.number(),
    content: z.string(), // base64
  })).default([]),
  spamVerdict: z.string(),
  virusVerdict: z.string(),
});

export async function emailInboundRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/email/inbound
   * Webhook handler for incoming emails from AWS Lambda
   */
  fastify.post<{
    Body: z.infer<typeof InboundEmailSchema>;
  }>('/api/email/inbound', async (request, reply) => {
    // 1. Verify webhook secret
    const secret = request.headers['x-webhook-secret'];
    if (secret !== WEBHOOK_SECRET) {
      fastify.log.warn('Invalid webhook secret');
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    // 2. Parse and validate body
    const parseResult = InboundEmailSchema.safeParse(request.body);
    if (!parseResult.success) {
      fastify.log.error({ errors: parseResult.error }, 'Invalid inbound email payload');
      return reply.code(400).send({ error: 'Invalid payload' });
    }

    const email = parseResult.data;

    // 3. Extract alias from recipient
    // e.g., "toby@inbox.getfamilyassistant.com" → "toby"
    const recipientMatch = email.recipient.match(/^([^@]+)@/);
    if (!recipientMatch) {
      fastify.log.warn({ recipient: email.recipient }, 'Could not parse recipient');
      return reply.code(400).send({ error: 'Invalid recipient format' });
    }
    const alias = recipientMatch[1].toLowerCase();

    // 4. Look up user by alias
    const user = getUserByHostedAlias(alias);
    if (!user) {
      fastify.log.info({ alias }, 'No user found for alias, ignoring email');
      return reply.code(200).send({ status: 'ignored', reason: 'unknown_alias' });
    }

    // 5. Check for duplicate
    const existing = getEmailBySourceId(user.user_id, 'hosted', email.messageId);
    if (existing) {
      fastify.log.info({ messageId: email.messageId }, 'Duplicate email, skipping');
      return reply.code(200).send({ status: 'duplicate' });
    }

    // 6. Build email body (prefer text, fall back to stripped HTML)
    let bodyText = email.textBody || '';
    if (!bodyText && email.htmlBody) {
      bodyText = email.htmlBody.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    // 7. Store email
    const emailId = createEmail(user.user_id, {
      gmail_message_id: email.messageId, // Reuse field for compatibility
      from_email: email.from,
      from_name: email.fromName,
      subject: email.subject,
      date: new Date(email.date),
      body_text: bodyText,
      snippet: bodyText.substring(0, 200),
      labels: ['HOSTED_INBOUND'],
      has_attachments: email.attachments.length > 0,
      source_type: 'hosted',
      source_message_id: email.messageId,
    });

    // 8. Process attachments
    if (email.attachments.length > 0) {
      const downloadedAttachments = email.attachments.map(att => ({
        filename: att.filename,
        mimeType: att.contentType,
        size: att.size,
        attachmentId: '', // Not from Gmail
        buffer: Buffer.from(att.content, 'base64'),
        extractedText: '', // Will be extracted
        extractionFailed: false,
      }));

      // Extract text and store
      for (const att of downloadedAttachments) {
        // Extract text based on mime type
        const { extractTextFromAttachment } = await import('../utils/attachmentExtractor.js');
        att.extractedText = await extractTextFromAttachment(att.buffer, att.mimeType, att.filename);
        att.extractionFailed = att.extractedText.includes('extraction failed');
      }

      storeDownloadedAttachments(user.user_id, emailId, downloadedAttachments);

      // Update email with attachment content
      const attachmentContent = buildAttachmentContent(downloadedAttachments);
      updateEmailAttachmentContent(emailId, attachmentContent);
    }

    // 9. Mark as processed (ready for analysis)
    markEmailProcessed(user.user_id, emailId);

    fastify.log.info(
      { emailId, alias, subject: email.subject, attachments: email.attachments.length },
      'Inbound email stored successfully'
    );

    return reply.code(200).send({ status: 'stored', emailId });
  });
}
```

### Register Route in app.ts

```typescript
import { emailInboundRoutes } from './routes/emailInboundRoutes.js';

// In the route registration section:
await fastify.register(emailInboundRoutes);
```

---

## Phase 5: User Database Functions

### New/Updated Functions in src/db/userDb.ts

```typescript
/**
 * Get user by hosted email alias
 */
export function getUserByHostedAlias(alias: string): User | null {
  const row = db.prepare(`
    SELECT * FROM users WHERE LOWER(hosted_email_alias) = LOWER(?)
  `).get(alias);
  return row ? parseUserRow(row) : null;
}

/**
 * Check if alias is available
 */
export function isAliasAvailable(alias: string): boolean {
  const row = db.prepare(`
    SELECT 1 FROM users WHERE LOWER(hosted_email_alias) = LOWER(?)
  `).get(alias);
  return !row;
}

/**
 * Claim hosted email alias for user
 */
export function setHostedEmailAlias(userId: string, alias: string): boolean {
  try {
    db.prepare(`
      UPDATE users
      SET hosted_email_alias = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(alias.toLowerCase(), userId);
    return true;
  } catch (error: any) {
    // Unique constraint violation
    if (error.code === 'SQLITE_CONSTRAINT') {
      return false;
    }
    throw error;
  }
}

/**
 * Clear hosted email alias (when switching back to Gmail)
 */
export function clearHostedEmailAlias(userId: string): void {
  db.prepare(`
    UPDATE users
    SET hosted_email_alias = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).run(userId);
}

/**
 * Get user's full hosted email address
 */
export function getHostedEmailAddress(userId: string): string | null {
  const user = getUser(userId);
  if (!user?.hosted_email_alias) return null;
  return `${user.hosted_email_alias}@inbox.getfamilyassistant.com`;
}
```

---

## Phase 6: Settings Updates

### Updated Settings Functions in src/db/settingsDb.ts

```typescript
/**
 * Get email source for user
 */
export function getEmailSource(userId: string): 'gmail' | 'hosted' {
  const settings = getOrCreateDefaultSettings(userId);
  return settings.email_source || 'gmail';
}

/**
 * Set email source for user
 */
export function setEmailSource(userId: string, source: 'gmail' | 'hosted'): void {
  db.prepare(`
    UPDATE user_settings
    SET email_source = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).run(source, userId);
}
```

### API Endpoint for Changing Email Source

Add to settingsRoutes.ts:

```typescript
/**
 * POST /api/settings/email-source
 * Change email source (gmail or hosted)
 */
fastify.post<{
  Body: { source: 'gmail' | 'hosted'; alias?: string };
}>('/api/settings/email-source', { preHandler: requireAuth }, async (request, reply) => {
  const userId = getUserId(request);
  const { source, alias } = request.body;

  if (source === 'hosted') {
    // Validate and claim alias
    if (!alias || alias.length < 2 || alias.length > 30) {
      return reply.code(400).send({ error: 'Alias must be 2-30 characters' });
    }

    if (!/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/i.test(alias)) {
      return reply.code(400).send({ error: 'Invalid alias format' });
    }

    if (!isAliasAvailable(alias)) {
      return reply.code(409).send({ error: 'Alias already taken' });
    }

    const success = setHostedEmailAlias(userId, alias);
    if (!success) {
      return reply.code(409).send({ error: 'Alias already taken' });
    }
  } else {
    // Switching to Gmail - clear hosted alias
    clearHostedEmailAlias(userId);
  }

  setEmailSource(userId, source);

  const hostedEmail = source === 'hosted'
    ? getHostedEmailAddress(userId)
    : null;

  return reply.code(200).send({
    success: true,
    emailSource: source,
    hostedEmail,
  });
});

/**
 * GET /api/settings/check-alias
 * Check if an alias is available
 */
fastify.get<{
  Querystring: { alias: string };
}>('/api/settings/check-alias', { preHandler: requireAuth }, async (request, reply) => {
  const alias = request.query.alias?.toLowerCase();

  if (!alias || alias.length < 2) {
    return reply.code(400).send({ error: 'Alias too short' });
  }

  const available = isAliasAvailable(alias);

  return reply.code(200).send({ alias, available });
});
```

---

## Phase 7: Daily Summary Updates

### Update Cron Job in src/plugins/dailySummary.ts

```typescript
// In the daily summary generation loop:

for (const user of usersWithSummaryEnabled) {
  const settings = getOrCreateDefaultSettings(user.user_id);

  if (settings.email_source === 'gmail') {
    // Existing Gmail flow - fetch new emails
    try {
      const auth = await getUserAuthSafe(user.user_id);
      if (auth) {
        await fetchAndStoreEmails(user.user_id, auth);
      }
    } catch (error) {
      console.error(`Gmail fetch failed for ${user.user_id}:`, error);
    }
  }
  // For hosted: emails already in DB via webhook, nothing to fetch

  // Both sources: analyze unanalyzed emails
  await analyzeUnanalyzedEmails(user.user_id);

  // Generate and send summary
  // ... existing code ...
}
```

---

## Phase 8: Settings UI

### Email Source Selection Component

Add to settings page template:

```html
<div class="settings-section">
  <h3>Email Source</h3>

  <div class="email-source-options">
    <label class="source-option">
      <input type="radio" name="emailSource" value="gmail"
             ${emailSource === 'gmail' ? 'checked' : ''}>
      <div class="option-content">
        <strong>Gmail Access</strong>
        <p>We read emails directly from your Gmail inbox</p>
        ${emailSource === 'gmail' ? '<span class="status connected">Connected</span>' : ''}
      </div>
    </label>

    <label class="source-option">
      <input type="radio" name="emailSource" value="hosted"
             ${emailSource === 'hosted' ? 'checked' : ''}>
      <div class="option-content">
        <strong>Forwarding Address</strong>
        <p>Forward school emails to your personal address</p>
      </div>
    </label>
  </div>

  <div id="hosted-setup" style="display: ${emailSource === 'hosted' ? 'block' : 'none'}">
    ${hostedEmail ? `
      <div class="hosted-address">
        <p>Your forwarding address:</p>
        <div class="address-display">
          <code>${hostedEmail}</code>
          <button onclick="copyAddress()">Copy</button>
        </div>
        <details>
          <summary>How to set up forwarding</summary>
          <div class="forwarding-instructions">
            <h4>Gmail</h4>
            <ol>
              <li>Go to Gmail Settings → "See all settings"</li>
              <li>Click "Forwarding and POP/IMAP" tab</li>
              <li>Click "Add a forwarding address"</li>
              <li>Enter: <code>${hostedEmail}</code></li>
              <li>Click "Proceed" → "OK"</li>
              <li>Check your school inbox for verification email</li>
              <li>Click the verification link</li>
              <li>Back in Gmail, select "Forward a copy of incoming mail to"</li>
            </ol>

            <h4>Outlook</h4>
            <ol>
              <li>Go to Settings → Mail → Forwarding</li>
              <li>Enable forwarding</li>
              <li>Enter: <code>${hostedEmail}</code></li>
              <li>Save</li>
            </ol>
          </div>
        </details>
      </div>
    ` : `
      <div class="alias-setup">
        <p>Choose your forwarding address:</p>
        <div class="alias-input">
          <input type="text" id="alias-input" placeholder="yourname"
                 pattern="[a-z0-9._-]+" minlength="2" maxlength="30">
          <span>@inbox.getfamilyassistant.com</span>
        </div>
        <div id="alias-status"></div>
        <button id="claim-alias-btn" onclick="claimAlias()">Claim Address</button>
      </div>
    `}
  </div>
</div>
```

### JavaScript for Settings Page

```javascript
// Check alias availability with debounce
let aliasCheckTimeout;
document.getElementById('alias-input')?.addEventListener('input', (e) => {
  clearTimeout(aliasCheckTimeout);
  const alias = e.target.value.toLowerCase();
  const statusEl = document.getElementById('alias-status');

  if (alias.length < 2) {
    statusEl.textContent = '';
    return;
  }

  statusEl.textContent = 'Checking...';

  aliasCheckTimeout = setTimeout(async () => {
    const res = await fetch(`/api/settings/check-alias?alias=${encodeURIComponent(alias)}`);
    const data = await res.json();

    if (data.available) {
      statusEl.innerHTML = '<span class="available">✓ Available</span>';
    } else {
      statusEl.innerHTML = '<span class="taken">✗ Already taken</span>';
    }
  }, 300);
});

// Claim alias
async function claimAlias() {
  const alias = document.getElementById('alias-input').value.toLowerCase();
  const btn = document.getElementById('claim-alias-btn');

  btn.disabled = true;
  btn.textContent = 'Claiming...';

  try {
    const res = await fetch('/api/settings/email-source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'hosted', alias })
    });

    const data = await res.json();

    if (res.ok) {
      window.location.reload();
    } else {
      alert(data.error || 'Failed to claim alias');
    }
  } catch (error) {
    alert('Error: ' + error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Claim Address';
  }
}

// Copy address to clipboard
function copyAddress() {
  const address = document.querySelector('.address-display code').textContent;
  navigator.clipboard.writeText(address);
  alert('Address copied!');
}

// Toggle hosted setup visibility
document.querySelectorAll('input[name="emailSource"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    const hostedSetup = document.getElementById('hosted-setup');
    hostedSetup.style.display = e.target.value === 'hosted' ? 'block' : 'none';

    if (e.target.value === 'gmail') {
      // Switch back to Gmail
      fetch('/api/settings/email-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'gmail' })
      }).then(() => window.location.reload());
    }
  });
});
```

---

## Phase 9: Environment Variables

Add to `.env`:

```bash
# Hosted Email Configuration
HOSTED_EMAIL_DOMAIN=inbox.getfamilyassistant.com
HOSTED_EMAIL_WEBHOOK_SECRET=<generate-secure-random-string>

# AWS Configuration (for reference, used in Lambda)
AWS_REGION=us-east-1
AWS_S3_EMAIL_BUCKET=getfamilyassistant-inbound-emails
```

---

## Testing Checklist

### Local Testing
- [ ] Migration 10 runs successfully
- [ ] Can claim alias via API
- [ ] Alias uniqueness enforced
- [ ] Can switch between gmail/hosted
- [ ] Inbound webhook accepts valid payload
- [ ] Inbound webhook rejects invalid secret
- [ ] Emails stored with correct source_type
- [ ] Attachments extracted and stored
- [ ] Analysis pipeline works for hosted emails
- [ ] Daily summary includes hosted emails

### AWS Testing
- [ ] SES domain verified
- [ ] MX records propagated
- [ ] Test email received by SES
- [ ] Email stored in S3
- [ ] Lambda triggered successfully
- [ ] Webhook called with correct payload
- [ ] End-to-end: send email → appears in app

### Edge Cases
- [ ] Very large attachments (>5MB) handled
- [ ] Spam emails filtered
- [ ] Duplicate emails rejected
- [ ] Invalid alias formats rejected
- [ ] Alias collision handled gracefully
- [ ] User switching sources mid-stream

---

## Rollback Plan

If issues arise:

1. **Lambda issues**: Disable SES receipt rule (emails still stored in S3)
2. **Webhook issues**: Lambda retries 3x, then dead-letter queue
3. **Database issues**: Migration 10 is additive (no destructive changes)
4. **User issues**: Admin can manually switch user back to Gmail source

---

## Future Enhancements

1. **Sender verification**: Only accept emails from known school domains
2. **Welcome email**: Send confirmation when user claims address
3. **Usage dashboard**: Show inbound email stats
4. **Custom domains**: Allow users to use their own domain
5. **Email threading**: Group related emails by thread
