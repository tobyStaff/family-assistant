# 001 — Progressive Detail for Summary Items — Implementation Plan

Companion to `001-more-detail.md`.

## Locked decisions

| # | Decision |
|---|---|
| 1 | Extend `ActionType` union; add `validateTokenReadOnly()` that does NOT mark `used_at` |
| 2 | **One view token per summary email**, target = `email_summaries.id`; URL encodes item id in path |
| 3 | AI context reused from `email_analyses.email_summary` (fallback: subject) — no new LLM calls |
| 4 | L3 body: plaintext → HTML (escape, linkify, paragraph breaks) |
| 5 | Done/Remove buttons on L2 **hidden entirely** when no session |
| 6 | Attachments gated by same view token (forwardable) |
| 7 | New minimal mobile-first layout, no sidebar |
| 8 | Related items list: include everything from the same source email (completed/removed struck-through; non-surfaced items shown) |

## URL scheme

Per-summary token, item ids in path:

```
/view/:token/todo/:id          ← L2 todo
/view/:token/event/:id         ← L2 event
/view/:token/email/:emailId    ← L3 source email
/view/:token/attachment/:id    ← file download
POST /view/:token/todo/:id/done      (session-required)
POST /view/:token/event/:id/remove   (session-required)
```

Every handler: `validateTokenReadOnly(token) → userId`, then verify requested item/email/attachment belongs to `userId`. Authorisation = "owner of token OR holds forwardable token for user_id that owns item".

---

## File-by-file plan

### 1. DB migration 26 — `src/db/db.ts`
Rebuild `email_action_tokens` table (SQLite can't alter CHECK constraints in place — same pattern as migration 16):
- Widen `action_type` CHECK to `('complete_todo', 'remove_event', 'view_summary')`
- Make `target_id` allow NULL (view tokens reference `email_summaries.id`, handle null defensively)
- Recreate indexes

Bump current migration version in `CLAUDE.md` to 26.

### 2. `src/db/emailActionTokenDb.ts`
- Widen `ActionType` union: `'complete_todo' | 'remove_event' | 'view_summary'`
- Add:
  ```ts
  export function createViewToken(userId: string, summaryId: number, expiresInDays = 7): string
  export function validateTokenReadOnly(token: string): TokenValidationResult
  ```
  Read-only variant: existence + expiry check, **does not update `used_at`**, returns `{ valid, userId, actionType, targetId }`.
- Existing `validateAndUseToken` untouched — still used by `/api/action/:token` for one-shot Done/Remove links.

### 3. `src/utils/personalizedSummaryBuilder.ts`
Where the daily summary is assembled (sent by `daily-summary` cron):
- After `email_summaries` row is inserted for the day, call `createViewToken(userId, summaryId)` **once**.
- Propagate `viewBaseUrl = ${baseUrl}/view/${token}` through `addActionsToSummary()`.
- On each `TodoWithAction` / `EventWithAction`, attach `detailUrl = ${viewBaseUrl}/todo/${id}` or `/event/${id}`.

Existing one-shot `actionUrl` for Done/Remove stays — unchanged, separate pattern.

### 4. `src/templates/personalizedEmailTemplate.ts`
Minimal change: in `renderTodo()` and `renderEvent()`, add a `"View details →"` link beneath the description if `detailUrl` is present. Same visual weight as the existing "Pay Now/Open Link" action — plain text link, not a button.

### 5. New: `src/templates/mobileDetailLayout.ts`
Small wrapper producing email-style mobile-first HTML: `<meta viewport>`, Plus Jakarta Sans stack, max-width 600px, padded, single-column. No sidebar. Reuse palette `#2A5C82` / `#FAF9F6` to match the email.

```ts
renderMobileLayout({ title, breadcrumb, content, footer }): string
```

### 6. New: `src/templates/itemDetailTemplate.ts` (L2)
Exports `renderTodoDetail()` and `renderEventDetail()`. Each page contains:
- **Header**: item title, when, child badge
- **AI context block**: 1-2 sentence `email_analyses.email_summary` (fallback `subject`)
- **Source breadcrumb** (always visible, persistent): sender name/email · subject · received date → links to L3 (`/view/:token/email/:emailId`)
- **Related items** section: all todos + events with matching `source_email_id`. Done/removed items get `text-decoration: line-through; opacity: 0.6`. Each related item links to its own L2.
- **Action buttons**, rendered **only if** `hasSession === true`:
  - Todo page: `POST /view/:token/todo/:id/done` (form, not GET, to avoid crawler-fired mutations)
  - Event page: `POST /view/:token/event/:id/remove`
- **L3 link**: "View original email →" at the bottom

### 7. New: `src/templates/sourceEmailTemplate.ts` (L3)
- **Header**: From / Subject / Date
- **Breadcrumb back**: "← Back to item" when we know which item the user came from (optional query param `?from=todo:123`); else a link back to dashboard
- **Body**: plaintext run through `renderEmailBody()` util (see #8)
- **Attachment content section**: if `emails.attachment_content` non-empty, render in a distinct block (monospace, muted) labelled "Attachment text (extracted)"
- **Attachment files**: list of `email_attachments` rows with filename, size, and link to `/view/:token/attachment/:id`

### 8. New: `src/utils/renderEmailBody.ts`
Pure utility, easily testable:
```ts
export function renderEmailBody(plain: string): string
```
Pipeline: HTML-escape → replace `\n\n+` with paragraph breaks → `\n` with `<br>` → linkify URLs (conservative regex: `https?://[^\s<]+`) → return as string of `<p>` blocks.

### 9. New: `src/routes/detailRoutes.ts`
Registered in `src/app.ts` alongside `actionRoutes`:

| Method | Path | Auth | Handler |
|---|---|---|---|
| GET | `/view/:token/todo/:id` | token (read-only) | fetch todo, verify ownership, render L2 |
| GET | `/view/:token/event/:id` | token | fetch event, verify ownership, render L2 |
| GET | `/view/:token/email/:emailId` | token | fetch email + attachments, render L3 |
| GET | `/view/:token/attachment/:id` | token | stream file from `storage_path` with correct `Content-Type` + `Content-Disposition` |
| POST | `/view/:token/todo/:id/done` | token **AND** session | `markTodoAsDone`, redirect back to L2 |
| POST | `/view/:token/event/:id/remove` | token **AND** session | `deleteEvent`, redirect back to L2 |

Ownership check pattern on every handler:
```ts
const result = validateTokenReadOnly(token);
if (!result.valid) return reply.code(410).type('text/html').send(...);
const todo = getTodo(result.userId, id);  // scoped by userId
if (!todo) return reply.code(404).send(...);
const hasSession = !!(request as any).userId;  // for button visibility
```

Attachments: `storage_path` is relative to `data/attachments/` — use `path.join` + `path.resolve`, then assert the resolved path stays inside the attachments root (traversal guard).

### 10. `src/app.ts`
Register `detailRoutes` after `actionRoutes`. Session middleware runs globally, so `request.userId` is present on `/view/*` when the user is logged in — L2 uses it to decide button visibility.

### 11. Tests — `src/tests/`

Following the CLAUDE.md test-first rule, write tests before the corresponding code:

- `emailActionTokenDb.test.ts` — `validateTokenReadOnly` returns valid result without touching `used_at`; expired token returns `valid: false`; re-calling repeatedly all succeed.
- `renderEmailBody.test.ts` — escapes HTML, linkifies URLs, preserves paragraph breaks, no-op on empty.
- `detailRoutes.test.ts` (integration, Fastify inject) —
  - L2 todo: 200 with valid token, 410 when expired, 404 when item belongs to another user, no Done button when no session, Done button when session set.
  - L3 email: renders body, lists attachments, includes breadcrumb.
  - Attachment route: serves file with correct mime; rejects path traversal; rejects token mismatch.
  - POST done/remove: 401/redirect when no session; 200 when session + valid token; idempotent on second call.
- Update existing summary-builder test to assert `detailUrl` is attached to items when a summary is generated.

### 12. Docs — `CLAUDE.md`
- Bump migration version to 26
- Add a line to "Email Action Tokens" explaining the `view_summary` read-only variant
- Add `/view/:token/...` URL scheme to the routing table section

---

## Flags (not blocking)

- **`email_summaries.id` availability at token-creation time** — verify the daily cron inserts into `email_summaries` *before* templating. If some paths skip the insert, add an explicit insert before token creation. Check this as step 0 of implementation.
- **`email_analyses.email_summary` availability** — not every email has an analysis row (signal/noise split). Fallback to `emails.subject` is in the plan.
- **Attachment mime sniffing** — trust stored `mime_type`; fallback to `application/octet-stream` with `Content-Disposition: attachment`.
- **Rate limiting** — view routes are unauthenticated in the token sense. Basic per-IP limit worth adding, but out of scope unless requested.

---

## Delivery order (smallest-coherent-diff first)

1. Migration 26 + `validateTokenReadOnly` + tests
2. `renderEmailBody` util + tests
3. `mobileDetailLayout` + `itemDetailTemplate` + `sourceEmailTemplate`
4. `detailRoutes` (GET handlers) + tests, registered in `app.ts`
5. Summary builder wiring: issue token, attach `detailUrl`
6. Email template: add "View details →" links
7. POST Done/Remove handlers + session gating + tests
8. Attachment serving + traversal guard + test
9. CLAUDE.md update
10. Full quality gate: `npx tsc --noEmit` + `pnpm test`

Each step is independently reviewable and individually shippable.
