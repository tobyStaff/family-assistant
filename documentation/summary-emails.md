# Summary Emails

## Pipeline Overview

Summary emails are built from data already in the database — no live API calls at send time. The pipeline runs in three daily stages:

```
[real-time]  →  POST /api/email/inbound — hosted email users only: emails arrive via AWS Lambda webhook and are stored directly in DB
6:00 AM UTC  →  daily-email-fetch    — Gmail users only: pulls unprocessed emails via OAuth, stores in DB  →  [details](./daily-email-fetch.md)
7:00 AM UTC  →  daily-email-analysis — all users: two-pass AI analysis, extracts todos/events, writes to DB
:00 each hr  →  daily-summary        — all users: checks if any user's summary_time_utc matches, sends email
```

---

## Step-by-Step: What `daily-summary` Does Per User

**File:** `src/plugins/dailySummary.ts:175`

1. Loads `user_settings` — skips if `summary_enabled=false`, no recipients configured, or the current UTC hour doesn't match the user's `summary_time_utc`
2. Runs `cleanupPastItems` — removes stale todos/events before building the email
3. Calls `generatePersonalizedSummary(userId, 7)` — looks 7 days ahead
4. Attaches action tokens (Done/Remove buttons) to every todo and event
5. Renders HTML via `renderPersonalizedEmail`
6. Sends via SES or Resend to all `summary_email_recipients`

---

## Building the Summary

**File:** `src/utils/personalizedSummaryBuilder.ts:316`

1. Queries `events` and `todos` tables for the user (DB-only, no external API calls)
2. Organizes items by child profile, or into "family wide" if no child is assigned
3. Splits items into **today** vs **upcoming** (tomorrow onwards)
4. Calls GPT-4o to generate:
   - Per-child insights (1–2 bullet points each)
   - Family-wide insights
   - A single **highlight** — the most important thing today (under 10 words)
5. Falls back to the first today event/todo title if GPT returns nothing

---

## Action Tokens

Each todo and event in the email gets a one-time token URL (`/api/action/:token`):

- **Done** — marks the todo as complete
- **Remove** — deletes the event

Tokens expire after 7 days. Created in `src/db/emailActionTokenDb.ts`, validated in `src/routes/actionRoutes.ts`.

---

## Known Bug

The `daily-summary` cron calls `getAllUserIds()` from `authDb` (`dailySummary.ts:238`), which queries the `auth` table. This means only users who have OAuth tokens receive summaries. It should query the `users` table instead so all users are covered regardless of OAuth state.
