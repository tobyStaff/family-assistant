---
name: code-review
description: Review staged or recent changes against a project checklist. Checks for common issues including missing env vars in docker-compose, security, error handling, and code quality. Use when asked to review code, check changes, or run a code review.
---

# Code Review

Review the current changes (staged, unstaged, or a specified commit/PR) against the checklist below.

## Instructions

### 1. Determine what to review

- If an argument is provided (e.g. a branch name, commit SHA, or PR number), review that diff
- Otherwise, review all staged and unstaged changes: `git diff HEAD`
- Also check `git status` to understand what files are affected

### 2. Read changed files

For each changed file, read the full file (not just the diff) to understand context.

### 3. Run through the checklist

Go through every item. Mark each as:
- ✅ Pass
- ❌ Fail (with explanation)
- ⚠️ Warning (not a hard failure but worth noting)
- N/A (not applicable to this change)

### 4. Output the report

Print a clear report with the checklist results, then a summary with overall verdict: **Pass**, **Pass with warnings**, or **Fail**.

---

## Checklist

### Environment & Configuration

- [ ] **New env vars added to `docker-compose.yml`** — Any new `process.env.XXX` usage must have a corresponding entry in the `environment:` section of `docker-compose.yml`. Check both the code changes and `docker-compose.yml` side by side.
- [ ] **New env vars added to `.env.example`** — Document any new env vars with a comment explaining what they're for.
- [ ] **No hardcoded secrets or credentials** — No API keys, tokens, passwords, or secrets in source code.
- [ ] **Environment-specific values use the `_LOCAL`/`_PROD` suffix pattern** — URLs and environment-specific config should follow the project convention in `config/env.ts`.

### TypeScript & Code Quality

- [ ] **No TypeScript errors** — Run `npx tsc --noEmit` and confirm no type errors.
- [ ] **No use of `any` without justification** — `any` casts should have a comment explaining why.
- [ ] **No `@ts-ignore` without a comment** — Every suppressed type error needs an explanation.
- [ ] **Async functions are properly awaited** — No floating promises; `async` functions in cron jobs and route handlers must be awaited or have `.catch()`.
- [ ] **Error handling is per-user/per-item** — Loops that process multiple users or items must have individual try/catch so one failure doesn't block others.

### Database & Migrations

- [ ] **New columns/tables have a migration** — Any schema change must be in a `if (version < N)` block in `db.ts` with an incremented version number.
- [ ] **No raw SQL string interpolation** — Use parameterised queries (`?` placeholders), never string concatenation with user input.

### Security

- [ ] **New routes have appropriate auth guards** — Admin routes use `requireAdmin`, protected routes use `requireAuth`. No unguarded routes that expose sensitive data.
- [ ] **User input is validated** — Any data from request body/params/query is validated before use.
- [ ] **No XSS vectors** — HTML rendered from user data must be escaped.
- [ ] **Impersonation handled correctly** — Routes that act on behalf of a user use `getUserId(request)` (respects impersonation), not raw `request.userId`. Auth/OAuth operations use `getRealUserId(request)`.

### Email Sending

- [ ] **Email sending failures don't crash the server** — `sendEmail` calls are in try/catch.
- [ ] **Recipients are not empty before sending** — Check `recipients.length > 0` before calling send functions.

### General

- [ ] **No duplicate functionality** — Search for existing code before adding new utilities or helpers.
- [ ] **Cron jobs log clearly** — Each cron job logs start, per-item outcome, and a summary at the end.
- [ ] **No console.log in production paths** — Use `fastify.log` or the passed logger, not `console.log`.

---

## Report Format

```
## Code Review — <files or description>

### Environment & Configuration
✅ New env vars added to docker-compose.yml
✅ New env vars added to .env.example
✅ No hardcoded secrets

### TypeScript & Code Quality
✅ No TypeScript errors
⚠️ `any` used in emailRoutes.ts:42 — no comment explaining why

### Database & Migrations
N/A — no schema changes

### Security
✅ New route has requireAdmin guard

### Email Sending
✅ sendEmail wrapped in try/catch

### General
❌ console.log found in src/utils/emailSender.ts:197 — use fastify.log

---
**Verdict: Pass with warnings**

Issues to fix:
- Replace console.log at emailSender.ts:197 with proper logger

Warnings:
- Add comment to `any` cast at emailRoutes.ts:42
```
