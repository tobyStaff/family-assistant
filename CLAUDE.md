# Claude Code Instructions - Inbox Manager

## Project Overview
Family inbox assistant that processes emails, extracts todos/events, and sends daily summary emails. Built with Fastify + TypeScript + SQLite.

## Quick Reference

### Key Directories
```
src/
├── app.ts              # Fastify app entry point, plugin/route registration
├── config/env.ts       # Environment loading (_LOCAL/_PROD URL resolution)
├── db/                 # Database modules (SQLite via better-sqlite3)
│   ├── db.ts           # Schema, migrations (current version: 8)
│   ├── emailDb.ts      # Stored emails CRUD
│   ├── todoDb.ts       # Todos CRUD
│   ├── eventDb.ts      # Events CRUD
│   ├── settingsDb.ts   # User settings
│   ├── userDb.ts       # Users, roles (STANDARD/ADMIN/SUPER_ADMIN)
│   ├── sessionDb.ts    # Session management
│   └── authDb.ts       # OAuth tokens (encrypted)
├── routes/             # API routes
│   ├── authRoutes.ts   # Google OAuth login/callback
│   ├── adminRoutes.ts  # Admin dashboard, impersonation, email preview/send
│   ├── emailRoutes.ts  # Email storage, /emails-view, /analyses-view
│   ├── actionRoutes.ts # Token-based email actions (Done/Remove buttons)
│   └── settingsRoutes.ts
├── plugins/
│   └── dailySummary.ts # Cron jobs (email fetch, analysis, daily summary)
├── templates/          # HTML templates for views and emails
│   ├── personalizedEmailTemplate.ts  # Daily summary email HTML
│   └── layout.ts       # Page layout wrapper
├── middleware/
│   ├── session.ts      # Session middleware, sets userId/userRoles/impersonatingUserId
│   └── authorization.ts # requireAdmin, requireSuperAdmin guards
├── lib/
│   ├── userContext.ts  # getUserId(), getUserAuth() - handles impersonation
│   └── crypto.ts       # Encryption for OAuth tokens
├── utils/
│   ├── emailStorageService.ts  # Fetch & store Gmail emails
│   ├── attachmentExtractor.ts  # PDF/DOCX text extraction
│   └── emailSender.ts  # Send emails via Gmail API
└── parsers/
    ├── aiParser.ts     # OpenAI/Anthropic abstraction
    └── eventTodoExtractor.ts # Extract todos/events from emails
```

### Database
- SQLite with WAL mode
- Location: `DB_PATH` env var (default: `./data/app.db`)
- Migrations run automatically on startup in `db.ts`

### Authentication Flow
1. Google OAuth via `/auth/google` → `/auth/google/callback`
2. Session stored in `sessions` table, cookie `session_id` (signed)
3. Tokens encrypted with `ENCRYPTION_SECRET`

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
BASE_URL_PROD=https://production.com
GOOGLE_REDIRECT_URI_LOCAL=http://localhost:3000/auth/google/callback
GOOGLE_REDIRECT_URI_PROD=https://production.com/auth/google/callback
```
Resolution in `config/env.ts` picks based on `NODE_ENV`.

### Email Action Tokens
- Tokens for "Done"/"Remove" buttons in emails
- Created in `emailActionTokenDb.ts`, validated in `actionRoutes.ts`
- Tokens stored in DB, expire after 7 days
- Route: `GET /api/action/:token`

### Roles
- `STANDARD` - Default for all users
- `ADMIN` - Access to admin routes
- `SUPER_ADMIN` - Can impersonate users (email: tobystafford.assistant@gmail.com)

## Common Patterns

### Adding a new route
1. Create in `src/routes/`
2. Register in `src/app.ts`
3. Use `requireAdmin` or `requireAuth` as preHandler

### Adding a migration
1. In `db.ts`, add new `if (version < N)` block
2. Run `db.exec()` for schema changes
3. Record migration with version number

### Checking impersonation in routes
```typescript
const impersonatingUserId = (request as any).impersonatingUserId;
const effectiveUserId = impersonatingUserId || (request as any).userId;
```

## Known Issues / Recent Fixes

### Email sending requires real user's auth
`getUserAuth()` uses `getRealUserId()` not `getUserId()` because impersonated users don't have OAuth tokens.

### Action buttons showing "Invalid or expired"
Usually means tokens created in one DB (local) but accessed from another (prod). Check `BASE_URL` resolves correctly for current `NODE_ENV`.

### PDF extraction
Uses `pdfjs-dist/legacy/build/pdf.js` with `pdfjs.default` for Node.js compatibility.

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
