# Onboarding Implementation Plan

## Phase 1: Split Login from Permission Grants

### 1.1 Minimal-scope login
- Modify `authRoutes.ts`: change `OAUTH_SCOPES` to only `['openid', 'email', 'profile']` for the default `/auth/google` route
- Add a new route `/auth/google/connect-gmail` that triggers a second OAuth flow with full scopes (`gmail.readonly`, `gmail.send`, `calendar`, `drive.file`)
- The callback (`/auth/google/callback`) already handles token upsert — just needs to detect whether this is a first login or a scope upgrade

### 1.2 Track Gmail connection state
- Add `gmail_connected BOOLEAN DEFAULT 0` to `users` table (migration 12)
- Set to `1` when callback receives tokens with Gmail scopes
- Existing users: backfill to `1` if they have an `auth` row with a refresh token

### 1.3 Track onboarding progress
- Add `onboarding_step INTEGER DEFAULT 0` to `users` table (same migration)
- Steps: 0=not started, 1=account created, 2=gmail connected, 3=senders selected, 4=children confirmed, 5=complete
- Existing users: backfill to `5` (complete)
- Add middleware/redirect: if `onboarding_step < 5`, redirect to `/onboarding`

### Files:
- **Modify**: `src/db/db.ts` (migration 12), `src/routes/authRoutes.ts`, `src/middleware/session.ts`
- **Modify**: `src/db/userDb.ts` (add `updateOnboardingStep`, `updateGmailConnected`)

---

## Phase 2: Sender Filtering

### 2.1 New DB table
```sql
CREATE TABLE sender_filters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  sender_name TEXT,
  status TEXT NOT NULL CHECK(status IN ('include', 'exclude')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  UNIQUE(user_id, sender_email)
);
```
Add in migration 12.

### 2.2 Inbox scan endpoint
- New route `POST /onboarding/scan-inbox`: fetch recent emails (last 30 days), deduplicate by sender, return top 20 unique senders with sample subject lines
- Return 5 at a time to frontend (paginated or chunked)

### 2.3 Save sender selections
- New route `POST /onboarding/save-senders`: save include/exclude choices to `sender_filters`
- New route `GET /onboarding/review-senders`: show current list for review/adjustment before confirming

### 2.4 Integrate filtering into email fetch
- Modify `emailStorageService.ts`: when fetching emails for daily cron, build Gmail query using `from:` filter from included senders
- Fallback: if no sender filters exist (legacy users), fetch all (backwards compatible)

### 2.5 Settings page sender management
- Add sender filter management UI to settings page for ongoing include/exclude changes

### Files:
- **Create**: `src/db/senderFilterDb.ts`
- **Modify**: `src/db/db.ts` (migration 12), `src/utils/emailStorageService.ts`
- **Modify**: `src/routes/settingsRoutes.ts`, `src/templates/settingsContent.ts`

---

## Phase 3: Onboarding UI & Child Profile Extraction

### 3.1 New onboarding template
- Replace inline HTML in `authRoutes.ts` (lines 459–1202) with a proper template file `src/templates/onboardingContent.ts`
- Multi-step wizard: Welcome → Connect Gmail → Scan Inbox → Review Senders → Child Profiles → First Email

### 3.2 Modified child extraction
- Reuse existing `extractChildProfiles()` but only scan emails from approved senders
- Existing review/confirm flow remains largely the same

### 3.3 Routes
- `GET /onboarding` — render current step based on `onboarding_step`
- `POST /onboarding/connect-gmail` — redirect to `/auth/google/connect-gmail`
- `POST /onboarding/scan-inbox` — (Phase 2)
- `POST /onboarding/save-senders` — (Phase 2)
- `POST /onboarding/analyze` — existing, modified to filter by approved senders
- `POST /onboarding/confirm` — existing, sets `onboarding_step = 5`

### Files:
- **Create**: `src/templates/onboardingContent.ts`
- **Modify**: `src/routes/authRoutes.ts` (extract onboarding routes, simplify)

---

## Phase 4: First Email & Completion

### 4.1 Generate first email
- New route `POST /onboarding/generate-first-email`: triggers summary generation for the user
- Wraps existing `generatePersonalizedSummary()` + `sendInboxSummary()` with a welcome message
- Sets `onboarding_step = 5`

### 4.2 Completion page
- Show links to todo list, events list, dashboard
- Explain daily email schedule

### Files:
- **Modify**: `src/templates/onboardingContent.ts`, `src/routes/authRoutes.ts`

---

## Phase 5: Admin Reset User (SUPER_ADMIN)

### 5.1 Reset endpoint
- New route `POST /admin/reset-user/:userId`
- Requires `requireSuperAdmin` middleware
- Deletes all data for the user across tables:
  - emails, email_attachments, email_analyses
  - todos, events, email_summaries
  - child_profiles, recurring_activities, processed_emails
  - sender_filters, email_action_tokens
  - auth (OAuth tokens)
- Resets `onboarding_step = 0`, `gmail_connected = 0` on users row
- Preserves the `users` row and active session

### 5.2 Admin UI
- Add "Reset User" button to admin dashboard user list
- Confirmation dialog before executing

### Files:
- **Modify**: `src/routes/adminRoutes.ts`, `src/templates/adminContent.ts`
- **Create**: `src/db/resetUserDb.ts` (or add to `userDb.ts`)

---

## Implementation Order

1. Migration 12 (new columns + sender_filters table)
2. Phase 5 — Admin reset (useful for testing everything else)
3. Phase 1 — Split auth scopes
4. Phase 2 — Sender filtering
5. Phase 3 — Onboarding UI
6. Phase 4 — First email
