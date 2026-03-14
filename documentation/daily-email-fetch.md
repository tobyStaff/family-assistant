# Daily Email Fetch

**Cron:** `src/plugins/dailySummary.ts:331` — `0 0 6 * * *` (daily, 6:00 AM UTC)

**Gmail users only.** Hosted email users receive emails in real-time via the `POST /api/email/inbound` webhook — they are not processed here.

Runs before the 7AM analysis job. Pulls new emails from Gmail for every user with an OAuth token and stores them locally in the `emails` table.

---

## Per-User Steps

For each user in the `auth` table (requires OAuth):

### 1. Build OAuth2 client
Decrypts the refresh/access tokens from the `auth` table and creates a Google OAuth2 client.

### 2. Apply sender filter
If the user has configured sender filters (`sender_filters` table), builds a Gmail query like:
```
{from:school@example.com OR from:club@example.com}
```
If no filters are configured, fetches from all senders.

### 3. Fetch & store (`fetchAndStoreEmails`)
Looks back 3 days, up to 500 messages per user:

- Queries Gmail for messages **without** the `PROCESSED` label, excluding spam/trash/sent
- For each message ID returned:
  - Skips if already in the local `emails` table
  - Fetches the full message (headers, body, attachments)
  - If attachments are present: extracts text from PDFs/DOCX/images and appends it to the body
  - Writes the row to the `emails` table and marks it `processed`
- After all messages are stored: applies a `PROCESSED` Gmail label in batch (up to 1000 at a time), then marks them `labeled` in the DB

### 4. Sync missed labels
If any previously stored emails are still unlabeled in Gmail (e.g. labeling failed on a prior run), retries applying the `PROCESSED` label.

---

## How "Unprocessed" Is Determined

The Gmail query used is:
```
after:YYYY/MM/DD -in:spam -in:trash -in:sent -label:PROCESSED [optional sender filter]
```

The `PROCESSED` label is created in the user's Gmail account on first use if it doesn't exist. Re-runs are safe — emails already labelled are excluded at the Gmail query level, with a DB-level `emailExists()` check as a second guard.

---

## What Gets Stored Per Email

| Field | Source |
|-------|--------|
| `from_email`, `from_name` | Parsed from `From` header |
| `subject` | `Subject` header |
| `date` | `Date` header |
| `body_text` | Plain text body (falls back to HTML stripped of tags) |
| `snippet` | Gmail snippet |
| `labels` | Gmail label IDs |
| `gmail_thread_id` | Thread grouping |
| `has_attachments` | Detected from message parts |
| `attachment_content` | Extracted text from PDF/DOCX/image attachments |
| `attachment_extraction_failed` | Flag if extraction failed |

Attachment files are also stored to the filesystem with metadata in the `attachments` table.

---

## Key Files

- `src/plugins/dailySummary.ts` — cron registration and per-user orchestration
- `src/utils/emailStorageService.ts` — `fetchAndStoreEmails`, `syncProcessedLabels`
- `src/utils/gmailLabelManager.ts` — `getUnprocessedMessageIds`, `applyProcessedLabel`
- `src/utils/attachmentExtractor.ts` — PDF/DOCX/image text extraction
- `src/db/emailDb.ts` — `createEmail`, `emailExists`, `markEmailProcessed`, `markEmailLabeled`
- `src/db/senderFilterDb.ts` — `hasSenderFilters`, `getIncludedSenders`
