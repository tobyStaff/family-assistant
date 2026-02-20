# Plan: Switch Outbound Email to AWS SES

## Context
Daily summary emails are currently sent via each user's Gmail OAuth credentials (Gmail API). This creates a dependency on users having Gmail connected just to receive their summary. The switch to SES decouples sending from Gmail auth, uses the user's unique `hosted_email_alias` as the from address (e.g. `toby@inbox.getfamilyassistant.com`), and reuses the existing verified SES domain already set up for inbound email.

**Uniqueness guarantee:** `hosted_email_alias` has a `UNIQUE INDEX` in the DB — one alias per user is already enforced at the DB layer.

**From address:** `<alias>@inbox.getfamilyassistant.com` per user, fallback `familybriefing@inbox.getfamilyassistant.com` if no alias set.

---

## Files to Change

| File | Change |
|------|--------|
| `package.json` | Add `@aws-sdk/client-ses` |
| `src/config/env.ts` | Add 4 new env vars |
| `src/utils/emailSender.ts` | Add 3 new helpers; deprecate old Gmail send functions |
| `src/plugins/dailySummary.ts` | Replace `sendInboxSummary` with `sendViaSES` |
| `src/routes/adminRoutes.ts` | Update 2 send call sites |
| `docker-compose.yml` | Add 4 AWS env var pass-throughs |
| `.env.example` | Document new vars |

---

## Step-by-Step Implementation

### 1. Install SDK
```bash
pnpm add @aws-sdk/client-ses
```

### 2. `src/config/env.ts` — add to both Zod schema and fastifyEnvOptions properties
```typescript
AWS_REGION: z.string().default('eu-north-1'),
AWS_ACCESS_KEY_ID: z.string().optional(),
AWS_SECRET_ACCESS_KEY: z.string().optional(),
SES_FROM_DOMAIN: z.string().default('inbox.getfamilyassistant.com'),
```

### 3. `src/utils/emailSender.ts` — add three new exports

**Import to add:**
```typescript
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
```

**Helper: `buildSummarySubject()`**
```typescript
export function buildSummarySubject(): string {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  return `Daily Briefing (${today})`;
}
```

**Helper: `buildSesFromAddress(alias: string | null): string`**
```typescript
export function buildSesFromAddress(alias: string | null): string {
  const domain = process.env.SES_FROM_DOMAIN || 'inbox.getfamilyassistant.com';
  return alias ? `${alias}@${domain}` : `familybriefing@${domain}`;
}
```

**Main function: `sendViaSES(html, recipients, fromAddress, subject)`**
- Instantiates `SESClient` with explicit credentials from env vars
- Throws if `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` are missing
- Sends all recipients in a single `SendEmailCommand` (multipart text+HTML)
- Returns `recipients.length` on success, throws on failure

**Existing functions:** Mark `sendInboxSummary` and `sendDailySummary` as `@deprecated` — do not delete yet (Gmail is still used for fetching).

### 4. `src/plugins/dailySummary.ts` — replace send block (~line 207-254)

- Import `sendViaSES`, `buildSesFromAddress`, `buildSummarySubject` from emailSender
- Import `getHostedEmailAlias` from `../db/userDb.js` (already exists)
- Remove `getUserAuth(userId)` from the send path (keep it in the email-fetch job)
- Remove `dummySummary` object
- Replace `sendInboxSummary(auth, dummySummary, html, recipients)` with:
  ```typescript
  const alias = getHostedEmailAlias(userId);
  const fromAddress = buildSesFromAddress(alias);
  const subject = buildSummarySubject();
  await sendViaSES(html, settings.summary_email_recipients, fromAddress, subject);
  ```
- Update success log to include `fromAddress` and `via: 'ses'`

### 5. `src/routes/adminRoutes.ts` — two call sites

**`POST /admin/test-gmail-send` (~line 400):** Rename to `test-ses-send`, remove Gmail scope check and `tokenInfo`, replace body with `sendViaSES` call using `buildSesFromAddress(getHostedEmailAlias(userId))`.

**`POST /admin/send-daily-summary` (~line 565):** Replace `sendInboxSummary(auth, dummySummary, html, recipients)` with:
```typescript
const alias = getHostedEmailAlias(userId);
const fromAddress = buildSesFromAddress(alias);
const sentCount = await sendViaSES(html, recipients, fromAddress, buildSummarySubject());
```
Remove `dummySummary` and any `auth` usage that was only needed for sending.

### 6. `docker-compose.yml` — add to environment block
```yaml
# AWS SES (outbound email)
- AWS_REGION=${AWS_REGION:-eu-north-1}
- AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
- AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
- SES_FROM_DOMAIN=${SES_FROM_DOMAIN:-inbox.getfamilyassistant.com}
```

### 7. `.env.example` — add section
```bash
# AWS SES (Outbound Email Sending)
# Create an IAM user with ses:SendEmail permission on SES domain
AWS_REGION=eu-north-1
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
SES_FROM_DOMAIN=inbox.getfamilyassistant.com
```

---

## AWS Prerequisites (before deploying)

1. Create an IAM user with this inline policy:
   ```json
   {
     "Effect": "Allow",
     "Action": "ses:SendEmail",
     "Resource": "*"
   }
   ```
2. Generate access key for that IAM user
3. Add the 4 env vars to the production `.env` on the VPS, then `docker compose down && docker compose up -d`

---

## Verification

1. `npx tsc --noEmit` — type check passes
2. `pnpm dev` locally with AWS vars set — app starts without error
3. Use `POST /admin/test-ses-send` to send a test email via SES
4. Trigger `POST /admin/send-daily-summary` and confirm email arrives from `<alias>@inbox.getfamilyassistant.com`
5. Check CloudWatch / SES send metrics for delivery confirmation
