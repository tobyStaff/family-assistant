# Claude Code Instructions - Inbox Manager

## Project Overview
Family inbox assistant SaaS that processes emails, extracts todos/events, and sends daily summary emails. Built with Fastify + TypeScript + SQLite. Has a 4-tier subscription model with Stripe, a 7-day onboarding sequence, hosted email support, and Google Calendar sync.

## Quick Reference

### Key Directories
```
src/
├── app.ts                    # Fastify entry point, plugin/route registration
├── config/
│   ├── env.ts               # Environment loading (_LOCAL/_PROD URL resolution)
│   └── tiers.ts             # Subscription tier config (FREE/ORGANIZED/PROFESSIONAL/CONCIERGE)
├── db/                       # Database modules (SQLite via better-sqlite3)
│   ├── db.ts                # Schema, migrations (current version: 24)
│   ├── authDb.ts            # OAuth tokens (encrypted); getAllUserIds() queries auth table
│   ├── userDb.ts            # Users, roles, suppression, trial, onboarding state
│   ├── sessionDb.ts         # Session management
│   ├── settingsDb.ts        # User settings (summary time, recipients, email source)
│   ├── emailDb.ts           # Stored emails CRUD
│   ├── todoDb.ts            # Todos CRUD
│   ├── eventDb.ts           # Events CRUD, Calendar sync status
│   ├── emailAnalysisDb.ts   # Two-pass analysis records
│   ├── emailActionTokenDb.ts# Token-based email action buttons
│   ├── attachmentDb.ts      # Attachment metadata
│   ├── childProfilesDb.ts   # Child profiles (real_name, display_name, year_group)
│   ├── recurringActivitiesDb.ts # School activities
│   ├── senderFilterDb.ts    # Per-sender preferences (boost/suppress/archive)
│   ├── relevanceFeedbackDb.ts # User feedback for AI training
│   ├── subscriptionDb.ts    # Stripe subscription data
│   ├── trialDb.ts           # Trial tracking
│   ├── metricsDb.ts         # AI metrics logging
│   └── summaryDb.ts         # Summary queries/storage
├── routes/
│   ├── authRoutes.ts        # Google OAuth login/callback
│   ├── adminRoutes.ts       # Admin dashboard, impersonation, email preview/send
│   ├── emailRoutes.ts       # Email storage, /emails-view, /analyses-view
│   ├── actionRoutes.ts      # Token-based email actions (Done/Remove)
│   ├── settingsRoutes.ts    # User preferences
│   ├── todoRoutes.ts        # Todo CRUD
│   ├── eventRoutes.ts       # Event CRUD
│   ├── calendarRoutes.ts    # Google Calendar sync
│   ├── onboardingRoutes.ts  # Onboarding flow (hosted/gmail paths)
│   ├── checkoutRoutes.ts    # Stripe checkout/subscribe
│   ├── webhookRoutes.ts     # SES bounce/complaint SNS webhooks
│   ├── emailInboundRoutes.ts# Hosted email inbound webhook (no session required)
│   ├── attachmentRoutes.ts  # Attachment serving
│   ├── processingRoutes.ts  # Email processing trigger
│   ├── metricsRoutes.ts     # Prometheus + AI metrics
│   ├── landingRoutes.ts     # Public landing/pricing pages
│   └── commandProcessor.ts  # Command processing via template tags
├── plugins/
│   ├── dailySummary.ts      # All cron jobs (email fetch, analysis, daily summary, onboarding)
│   └── metrics.ts           # Prometheus metrics
├── templates/               # HTML templates for views and emails (18 files)
│   ├── personalizedEmailTemplate.ts  # Daily summary email HTML
│   ├── onboardingSequenceEmails.ts   # 7-day onboarding email templates
│   └── layout.ts            # Page layout wrapper
├── middleware/
│   ├── session.ts           # Session middleware, sets userId/userRoles/impersonatingUserId
│   └── authorization.ts     # requireAdmin, requireSuperAdmin, requireNoImpersonation guards
├── lib/
│   ├── userContext.ts       # getUserId(), getRealUserId(), getUserAuth() - impersonation handling
│   └── crypto.ts            # Encryption for OAuth tokens
├── services/
│   └── stripeService.ts     # Stripe API wrapper
├── utils/                   # ~30 utility modules
│   ├── emailStorageService.ts       # Fetch & store Gmail emails
│   ├── emailSender.ts               # Send via SES or Resend (EMAIL_PROVIDER env)
│   ├── personalizedSummaryBuilder.ts # Build daily summary from DB
│   ├── eventSyncService.ts          # Sync events to Google Calendar
│   ├── onboardingSequence.ts        # 7-day onboarding email sequence logic
│   ├── cleanupPastItems.ts          # Remove old todos/events before summary
│   └── attachmentExtractor.ts       # PDF/DOCX/image text extraction
└── parsers/
    ├── aiParser.ts          # OpenAI/Anthropic abstraction
    ├── twoPassAnalyzer.ts   # Two-pass email analysis (human + AI)
    └── eventTodoExtractor.ts# Extract todos/events from emails
```

### Database
- SQLite with WAL mode
- Location: `DB_PATH` env var; in Docker: `/app/data/app.db` (named volume `db-data`)
- Migrations run automatically on startup in `db.ts`
- **Current migration version: 26**

### Key DB Tables
| Table | Purpose |
|-------|---------|
| `users` | Profile, roles, suppression, trial_started_at, onboarding_step/path, gmail_connected |
| `auth` | Encrypted OAuth tokens — **only users who have logged in have a row here** |
| `sessions` | Cookie-based sessions |
| `user_settings` | summary_enabled, summary_time_utc, summary_email_recipients, email_source |
| `emails` | Stored emails with attachment content, processing flags |
| `email_analyses` | Two-pass analysis (human + AI), quality scoring |
| `email_action_tokens` | Tokens for Done/Remove buttons (7-day expiry) |
| `todos` | Tasks with type, child_name, due_date, confidence, boost_level |
| `events` | Calendar events with Google Calendar sync status |
| `child_profiles` | real_name, display_name, year_group |
| `subscriptions` | Stripe data (tier, status, trial, period dates) |
| `onboarding_emails_sent` | Tracks which 7-day sequence emails have been sent |
| `sender_filters` | Per-sender boost/suppress/archive preferences |
| `relevance_feedback` | User feedback on email relevance for AI training |

### Subscription Tiers
Defined in `src/config/tiers.ts` and `src/types/subscription.ts`:
- `FREE` — 3 senders, 1 recipient, 1 family member
- `ORGANIZED` (£9/mo) — 20 senders, 2 recipients, daily_brief, attachment_analysis
- `PROFESSIONAL` (£18/mo) — unlimited senders, 4 recipients, hosted_email, calendar_sync, ai_vision, action_links
- `CONCIERGE` (£38/mo) — unlimited everything

### Authentication Flow
1. Google OAuth via `/auth/google` → `/auth/google/callback`
2. Session stored in `sessions` table, cookie `session_id` (signed)
3. OAuth tokens encrypted with `ENCRYPTION_SECRET` and stored in `auth` table

### Impersonation (SUPER_ADMIN only)
- Cookie: `impersonate_user_id` (signed)
- `session.ts` middleware sets `request.impersonatingUserId`
- `getUserId(request)` returns impersonated user ID when active
- `getRealUserId(request)` always returns actual logged-in user
- `getUserAuth(request)` uses REAL user's OAuth (admin's Gmail credentials)

### Environment Variables
Uses `_LOCAL` and `_PROD` suffixes for URLs:
```bash
BASE_URL_LOCAL=http://localhost:3000
BASE_URL_PROD=https://getfamilyassistant.com
GOOGLE_REDIRECT_URI_LOCAL=http://localhost:3000/auth/google/callback
GOOGLE_REDIRECT_URI_PROD=https://getfamilyassistant.com/auth/google/callback
```
Resolution in `config/env.ts` picks based on `NODE_ENV`.

Key env vars:
- `EMAIL_PROVIDER` — `ses` (default) or `resend`
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` — for SES
- `SES_FROM_DOMAIN` — default `inbox.getfamilyassistant.com`
- `RESEND_API_KEY` — if using Resend
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — Stripe integration
- `HOSTED_EMAIL_WEBHOOK_SECRET` — inbound email webhook auth

### Cron Jobs (all in `plugins/dailySummary.ts`)
| Job | Schedule | Purpose |
|-----|----------|---------|
| `daily-email-fetch` | 6:00 AM UTC | Fetch Gmail for all users with auth rows |
| `daily-email-analysis` | 7:00 AM UTC | Two-pass AI analysis of unanalyzed emails |
| `daily-summary` | Every hour :00 | Sends summary to users whose `summary_time_utc` matches current hour |
| `onboarding-sequence` | 8:00 AM UTC | Sends days 2-7 onboarding emails for trial users |
| `event-sync-retry` | Every 15 min | Retry pending Google Calendar event syncs |
| `session-cleanup` | 2:00 AM UTC | Delete expired sessions and action tokens |

**Important:** `daily-email-fetch` and `daily-email-analysis` use `getAllUserIds()` from the `auth` table (requires login). `daily-summary` and `onboarding-sequence` should use the `users` table since they don't need OAuth.

### Email Sending
- Outbound via `sendEmail()` in `utils/emailSender.ts`
- Routes to SES or Resend based on `EMAIL_PROVIDER` env var
- `isEmailSuppressed()` checked before every send — suppression set by SES bounce/complaint SNS webhooks
- From address: `buildSesFromAddress(alias)` uses user's `hosted_email_alias` or `familybriefing@<domain>`

### Email Action Tokens
- Tokens for "Done"/"Remove" buttons in daily summary emails
- Created in `emailActionTokenDb.ts`, validated in `actionRoutes.ts`
- Expire after 7 days
- Route: `GET /api/action/:token`
- **Action types**: `complete_todo`, `remove_event` (one-shot, consumed by `validateAndUseToken`), and `view_summary` (forwardable, read-only, validated by `validateTokenReadOnly` — does not mark `used_at`, `target_id` is NULL)
- One `view_summary` token is minted per daily summary email and gates the progressive-detail routes below.

### Progressive Detail (L2/L3) — `detailRoutes.ts`
- `GET /view/:token/todo/:id` — item detail page for a todo
- `GET /view/:token/event/:id` — item detail page for an event
- `GET /view/:token/email/:emailId` — original source email rendered as mobile-styled HTML (plaintext → linkified HTML via `utils/renderEmailBody.ts`); supports `?from=todo:N` / `?from=event:N` for a back-to-item breadcrumb
- `GET /view/:token/attachment/:id` — stream an attachment file (path-traversal-guarded under `data/attachments/`)
- `POST /view/:token/todo/:id/done` and `/event/:id/remove` — mutating actions, require both a valid token AND a session whose user matches the token owner
- Read-only routes are forwardable (token survives reads); Done/Remove buttons are hidden in L2 when no session.

### Hosted Email
- Users can claim an alias (e.g. `toby@inbox.getfamilyassistant.com`)
- Inbound emails hit `/api/inbound/email` (no session required, webhook secret auth)
- Onboarding path: `hosted` vs `gmail` (stored in `users.onboarding_path`)

### Roles
- `STANDARD` — Default for all users
- `ADMIN` — Access to admin routes
- `SUPER_ADMIN` — Can impersonate users (email: tobystafford.assistant@gmail.com)

## Rules
- **Avoid duplicating functionality** — always search for existing code that might be similar or the same before adding new code.
- **`daily-summary` cron must not rely on the `auth` table** — use `users` table so all users receive summaries regardless of OAuth state.

## Quality Gate — Mandatory for Every Code Change

### Pre-change baseline (run before touching any code)
```bash
npx tsc --noEmit   # record whether it's clean
pnpm test          # record pass/fail count
```

### Post-change gate (must pass before marking done)
```bash
npx tsc --noEmit   # must be clean (no new errors)
pnpm test          # must not regress (same or more passing tests)
```

**Block completion if either check fails.** Fix the failure before declaring the task done.

### Test-first rule for logic changes
For any change that modifies business logic (cron jobs, DB queries, parsers, route handlers, utils):
1. Identify the affected module
2. Write or update a test that covers the intended behaviour **before** making the change
3. Confirm the test fails (red)
4. Make the code change
5. Confirm the test passes (green)
6. Run the full post-change gate above

Tests live in `src/tests/`. Use Vitest (`pnpm test`).

## Common Patterns

### Adding a new route
1. Create in `src/routes/`
2. Register in `src/app.ts`
3. Use `requireAdmin`, `requireSuperAdmin`, or `requireAuth` as preHandler

### Adding a migration
1. In `db.ts`, add new `if (version < N)` block
2. Run `db.exec()` for schema changes
3. Increment version number

### Checking impersonation in routes
```typescript
const impersonatingUserId = (request as any).impersonatingUserId;
const effectiveUserId = impersonatingUserId || (request as any).userId;
```

### Checking subscription tier limits
Use helpers in `utils/tierLimits.ts`.

## Known Issues / Recent Fixes

### Email sending requires real user's auth
`getUserAuth()` uses `getRealUserId()` not `getUserId()` because impersonated users don't have OAuth tokens.

### Action buttons showing "Invalid or expired"
Usually means tokens created in one DB (local) but accessed from another (prod). Check `BASE_URL` resolves correctly for current `NODE_ENV`.

### PDF extraction
Uses `pdfjs-dist/legacy/build/pdf.js` with `pdfjs.default` for Node.js compatibility.

### Production DB location
Runs in Docker with a named volume. DB is at `/app/data/app.db` inside the `inbox-manager` container:
```bash
docker exec inbox-manager sqlite3 /app/data/app.db "SELECT ..."
# sqlite3 not installed by default — install with: apk add sqlite
# Or copy out: docker cp inbox-manager:/app/data/app.db /tmp/app.db
```

## Scripts
```bash
pnpm dev          # Development (NODE_ENV=development)
pnpm build        # Compile TypeScript
pnpm start:prod   # Production (NODE_ENV=production)
pnpm test         # Run tests
```

## Testing Changes
1. `npx tsc --noEmit` - Type check
2. `pnpm dev` - Run locally
3. Check console for `[env]` logs showing resolved URLs
