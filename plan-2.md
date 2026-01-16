# Google OAuth Authentication Implementation Plan

## Overview
Implement cookie-based Google OAuth authentication with Calendar, Gmail, and Drive integration. Users can sign up with Google, and their profile + tokens are stored securely.

**User Requirements:**
- Cookie-based sessions (simpler than JWT)
- OAuth scopes: Calendar, Gmail, Drive, User profile
- Simple HTML pages for auth flow
- Store user profile (email, name, picture)

**Success Criteria:**
- Users can sign in with Google
- Session persists across requests
- Protected routes require authentication
- Tokens auto-refresh when expired
- Dashboard shows user profile

---

## Phase 1: Database Schema Updates

### Add Users and Sessions Tables

**File:** `src/db/db.ts`

Add these tables after the existing schema:

```sql
-- Users table for profile data
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,           -- Google's 'sub' from OAuth
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  picture_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Sessions table for cookie-based auth
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,        -- Random UUID
  user_id TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
```

### Create Session Database API

**New file:** `src/db/sessionDb.ts`

Functions needed:
- `createSession(userId: string, expiresAt: Date): string` - Returns session_id
- `getSession(sessionId: string): { user_id: string } | null` - Validates expiry
- `deleteSession(sessionId: string): boolean`
- `deleteUserSessions(userId: string): number` - For logout all devices
- `cleanupExpiredSessions(): number` - For cron job

Pattern: Follow `src/db/authDb.ts` structure with prepared statements.

### Create Users Database API

**New file:** `src/db/userDb.ts`

Functions needed:
- `upsertUser(user: UserProfile): void`
- `getUser(userId: string): UserProfile | null`
- `getUserByEmail(email: string): UserProfile | null`
- `updateUser(userId: string, updates: Partial<UserProfile>): boolean`
- `deleteUser(userId: string): boolean`

**Type definition** (add to `src/types/todo.ts`):
```typescript
export interface UserProfile {
  user_id: string;
  email: string;
  name?: string;
  picture_url?: string;
  created_at?: Date;
  updated_at?: Date;
}
```

---

## Phase 2: OAuth Routes

**New file:** `src/routes/authRoutes.ts`

### Route 1: GET /auth/google
Initiate OAuth flow:
1. Generate random CSRF state token (32 bytes hex)
2. Store state in signed cookie (10min expiry)
3. Create OAuth2Client with env credentials
4. Generate authorization URL with:
   - Scopes: `https://www.googleapis.com/auth/gmail.readonly`, `calendar`, `drive.file`, `profile`, `email`
   - `access_type: 'offline'` (critical for refresh token)
   - `prompt: 'consent'` (forces consent screen)
   - `state` parameter for CSRF
5. Redirect to Google authorization URL

### Route 2: GET /auth/callback
Handle OAuth callback:
1. Verify CSRF state matches cookie, clear state cookie
2. Exchange code for tokens using `oauth2Client.getToken(code)`
3. Decode id_token to get user profile (sub, email, name, picture)
4. Encrypt tokens using `src/lib/crypto.ts`
5. Store encrypted tokens in `auth` table via `storeAuth()`
6. Upsert user profile in `users` table via `upsertUser()`
7. Create session via `createSession()` (30 days expiry)
8. Set httpOnly cookie with session_id
9. Redirect to `/dashboard` on success, `/auth/error?message=...` on failure

### Route 3: POST /logout
1. Extract session_id from cookie
2. Delete session via `deleteSession()`
3. Clear cookie
4. Return success or redirect to `/login`

### Route 4: GET /login (serve HTML)
Simple login page with "Sign in with Google" button

### Route 5: GET /dashboard (protected, server-rendered)
1. Require authentication via middleware
2. Get user profile from `getUser(userId)`
3. Render HTML with user info (email, name, picture)
4. Include logout button

### Route 6: GET /auth/error
Error page with message from query parameter

---

## Phase 3: Session Management & Middleware

### Create Session Middleware

**New file:** `src/middleware/session.ts`

Two functions:

**1. sessionMiddleware** (global hook):
```typescript
export async function sessionMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const sessionId = request.cookies.session_id;

  if (sessionId) {
    const session = getSession(sessionId);
    if (session) {
      (request as any).userId = session.user_id;
    }
  }
}
```

**2. requireAuth** (route-specific hook):
```typescript
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = (request as any).userId;

  if (!userId) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Please log in to access this resource'
    });
  }
}
```

### Create User Context Helpers

**New file:** `src/lib/userContext.ts`

Central implementation of auth helper functions:

**1. getUserId(request: FastifyRequest): string**
- Extract userId from `(request as any).userId`
- Throw if not authenticated

**2. getUserAuth(request: FastifyRequest): Promise<OAuth2Client>**
- Get userId from request
- Fetch encrypted tokens from `getAuth(userId)`
- Decrypt tokens using `src/lib/crypto.ts`
- Create OAuth2Client and set credentials
- Check if token expired (5min buffer)
- Auto-refresh if needed and update database
- Return OAuth2Client

**Token refresh logic:**
```typescript
async function refreshAccessToken(oauth2Client: OAuth2Client, userId: string) {
  const { credentials } = await oauth2Client.refreshAccessToken();

  if (credentials.access_token && credentials.expiry_date) {
    const encrypted = encrypt(credentials.access_token);
    const encryptedData = `${encrypted.iv}:${encrypted.content}`;
    updateAccessToken(userId, encryptedData, new Date(credentials.expiry_date));
  }
}
```

**Note:** Store encrypted tokens as `"iv:content"` format for simplicity.

---

## Phase 4: Update Existing Routes

Replace placeholder functions in these files:

### Files to modify:
1. `src/routes/todoRoutes.ts`
2. `src/routes/calendarRoutes.ts`
3. `src/routes/commandProcessor.ts`
4. `src/routes/attachmentRoutes.ts`

### Changes for each:

**Remove these placeholder functions:**
```typescript
function getUserId(_request: FastifyRequest): string {
  throw new Error('Auth not implemented - placeholder for deliverable 1/2');
}
```

**Add import:**
```typescript
import { getUserId, getUserAuth } from '../lib/userContext.js';
import { requireAuth } from '../middleware/session.js';
```

**Protect routes:**
```typescript
// Example
fastify.get('/todos', { preHandler: requireAuth }, async (request, reply) => {
  const userId = getUserId(request);
  // ... existing logic
});
```

### Update Daily Summary Plugin

**File:** `src/plugins/dailySummary.ts`

Replace placeholder getUserAuth() and getUserEmail() with proper implementations that:
- Fetch auth from database for each user_id
- Decrypt tokens and create OAuth2Client
- Fetch user profile for email address

---

## Phase 5: HTML Pages

### Create public directory
**Directory:** `public/`

### Login Page
**File:** `public/login.html`

Features:
- Gradient background
- Centered card with title
- "Sign in with Google" button linking to `/auth/google`
- Google logo SVG
- Responsive design

### Dashboard Template
**Implementation:** Server-rendered in `authRoutes.ts` (GET /dashboard)

Features:
- Header with user avatar, name, email
- Logout button (POST form)
- Links to API endpoints (todos, calendar, etc.)
- Session check JavaScript (optional)

### Error Page Template
**Implementation:** Server-rendered in `authRoutes.ts` (GET /auth/error)

Features:
- Error icon
- Error message from query param
- "Try Again" button linking to `/login`

---

## Phase 6: App Integration

### Update App.ts

**File:** `src/app.ts`

**Add imports:**
```typescript
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { join } from 'path';
import { authRoutes } from './routes/authRoutes.js';
import sessionCleanupPlugin from './plugins/sessionCleanup.js';
import { sessionMiddleware } from './middleware/session.js';
```

**Register plugins (in order):**
```typescript
// 1. Cookie plugin
await fastify.register(cookie, {
  secret: process.env.ENCRYPTION_SECRET,
  parseOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 // 30 days
  }
});

// 2. Static files
await fastify.register(fastifyStatic, {
  root: join(process.cwd(), 'public'),
  prefix: '/public/'
});

// 3. Session middleware (global)
fastify.addHook('onRequest', sessionMiddleware);

// 4. Existing plugins
await fastify.register(metricsPlugin);
await fastify.register(dailySummaryPlugin);
await fastify.register(sessionCleanupPlugin); // NEW

// 5. Routes (auth routes first!)
await fastify.register(authRoutes);
await fastify.register(calendarRoutes);
await fastify.register(todoRoutes);
await fastify.register(commandProcessorRoutes);
```

### Create Session Cleanup Plugin

**New file:** `src/plugins/sessionCleanup.ts`

Cron job to delete expired sessions:
- Schedule: `0 0 2 * * *` (daily at 2 AM UTC)
- Function: Call `cleanupExpiredSessions()` from sessionDb
- Log count of deleted sessions

Pattern: Follow `src/plugins/dailySummary.ts` structure.

### Install Dependencies

```bash
pnpm add @fastify/static
```

(Other dependencies already installed: @fastify/cookie, googleapis, google-auth-library)

---

## Phase 7: Token Storage Format

**Important decision:** Store encrypted tokens with IV in database.

**Option A (Recommended):** Store as `"iv:content"` string
- Simpler schema (no extra columns)
- Easy to split and decrypt
- Example: `"a1b2c3d4:e5f6g7h8..."`

**Option B:** Add separate IV columns to auth table
```sql
ALTER TABLE auth ADD COLUMN refresh_token_iv TEXT;
ALTER TABLE auth ADD COLUMN access_token_iv TEXT;
```

**Recommendation:** Use Option A for simplicity. Update `authDb.ts` functions to handle this format when storing/retrieving.

---

## Phase 8: Testing Strategy

### Local Testing
1. Start server: `pnpm dev`
2. Visit `http://localhost:3000/login`
3. Click "Sign in with Google"
4. Accept permissions
5. Should redirect to `/dashboard` with your profile
6. Test protected routes: `curl -b cookies.txt http://localhost:3000/todos`
7. Test logout, verify session cleared
8. Restart server, verify session persists

### Database Verification
```bash
sqlite3 data/inbox.db

-- Check users
SELECT * FROM users;

-- Check sessions
SELECT session_id, user_id, datetime(expires_at) FROM sessions;

-- Check auth (tokens should be encrypted)
SELECT user_id, substr(refresh_token, 1, 20) || '...' FROM auth;
```

### Unit Tests
Create test files:
- `src/db/sessionDb.test.ts` - Session CRUD operations
- `src/db/userDb.test.ts` - User CRUD operations
- `src/lib/userContext.test.ts` - getUserId, getUserAuth with mocks
- `src/middleware/session.test.ts` - Middleware behavior

Pattern: Follow `src/db/authDb.test.ts` structure using Vitest.

---

## Security Checklist

Before deployment:
- [ ] `ENCRYPTION_SECRET` is strong (32+ chars, random)
- [ ] OAuth includes `access_type: 'offline'` and `prompt: 'consent'`
- [ ] Cookies have `httpOnly: true` and `secure: true` in production
- [ ] CSRF state parameter verified in callback
- [ ] Tokens encrypted before database storage
- [ ] Session expiry validated (30 days)
- [ ] Token refresh working (test by setting short expiry)
- [ ] Google OAuth redirect URI matches deployment domain
- [ ] HTTPS enabled in production

---

## Implementation Sequence

Recommended order:

### Day 1: Database & Core Functions
1. Update `src/db/db.ts` with users and sessions tables
2. Create `src/db/sessionDb.ts` with CRUD operations
3. Create `src/db/userDb.ts` with CRUD operations
4. Add UserProfile type to `src/types/todo.ts`
5. Write unit tests for sessionDb and userDb

### Day 2: OAuth Routes
1. Create `src/routes/authRoutes.ts`
2. Implement `/auth/google` (initiate flow)
3. Implement `/auth/callback` (exchange tokens)
4. Implement `/logout`
5. Test OAuth flow manually with Google account

### Day 3: Session Management
1. Create `src/middleware/session.ts` (sessionMiddleware + requireAuth)
2. Create `src/lib/userContext.ts` (getUserId + getUserAuth + refresh logic)
3. Test session persistence and token refresh
4. Write unit tests

### Day 4: Route Integration
1. Update `src/routes/todoRoutes.ts` - remove placeholders, add requireAuth
2. Update `src/routes/calendarRoutes.ts` - same
3. Update `src/routes/commandProcessor.ts` - same
4. Update `src/plugins/dailySummary.ts` - implement getUserAuth/getUserEmail
5. Test all protected routes

### Day 5: HTML & UI
1. Create `public/login.html`
2. Implement server-rendered dashboard in authRoutes.ts
3. Implement error page
4. Style and test UI flow

### Day 6: Integration & Polish
1. Update `src/app.ts` - register cookie plugin, static files, middleware, routes
2. Create `src/plugins/sessionCleanup.ts` cron job
3. Install `@fastify/static` dependency
4. End-to-end testing
5. Write integration tests

### Day 7: Documentation & Deployment
1. Update README with auth setup instructions
2. Test production build and Docker deployment
3. Security audit
4. Performance testing with multiple sessions

---

## Critical Files Summary

### New Files (9 files)
1. `src/db/sessionDb.ts` - Session database operations
2. `src/db/userDb.ts` - User database operations
3. `src/routes/authRoutes.ts` - OAuth flow routes + HTML pages
4. `src/middleware/session.ts` - Session middleware
5. `src/lib/userContext.ts` - getUserId/getUserAuth implementation
6. `src/plugins/sessionCleanup.ts` - Expired session cleanup cron
7. `public/login.html` - Login page
8. `src/db/sessionDb.test.ts` - Session tests
9. `src/lib/userContext.test.ts` - Context tests

### Modified Files (7 files)
1. `src/db/db.ts` - Add users and sessions tables
2. `src/app.ts` - Register plugins, middleware, routes
3. `src/routes/todoRoutes.ts` - Replace getUserId placeholder
4. `src/routes/calendarRoutes.ts` - Replace getUserAuth placeholder
5. `src/routes/commandProcessor.ts` - Replace placeholders
6. `src/plugins/dailySummary.ts` - Implement getUserAuth/getUserEmail
7. `src/types/todo.ts` - Add UserProfile interface

---

## Error Handling

### Token Revocation
If user revokes access in Google Account settings:
- Catch `invalid_grant` error during token refresh
- Delete auth entry from database
- Delete all user sessions
- Return 401 with message "Please log in again"

### Missing Refresh Token
Ensure OAuth URL includes:
- `access_type: 'offline'`
- `prompt: 'consent'`

If callback doesn't receive refresh_token:
- Log error
- Redirect to `/auth/error?message=Configuration error`

### Session Expiry
- Middleware checks expiry on every request
- Return 401 if session expired
- Frontend redirects to `/login`

### Concurrent Logins
- Allow multiple sessions per user (good UX)
- Each device gets separate session_id
- Logout can delete single session or all sessions

---

## Performance Notes

**Expected auth overhead per request:**
- Session lookup: < 1ms (indexed query)
- User lookup: < 1ms (indexed query)
- Token decryption: < 1ms
- **Total: < 5ms per request**

**Token refresh rate:**
- Access tokens expire every 1 hour
- Refresh happens at 55 minutes (5min buffer)
- At 2,000 users: ~33 refreshes/minute average
- Uses ~5% of Google API quota

**Database performance:**
- SQLite WAL mode handles ~50,000 reads/sec
- Prepared statements cached
- Indexes on all foreign keys
- **Bottleneck will be Google API calls, not auth**

---

## Next Steps

After completing implementation:

1. **Test OAuth flow** with real Google account
2. **Verify session persistence** across server restarts
3. **Test token refresh** by setting short expiry
4. **Check database encryption** - tokens should be hex strings
5. **Test protected routes** with and without authentication
6. **Deploy to production** with HTTPS and update redirect URI
7. **Monitor logs** for errors and token refresh patterns

---

## Rollback Plan

If implementation fails:

**Database:**
```sql
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
```

**Code:**
```bash
git revert <commit-hash>
```

**Dependencies:**
```bash
pnpm remove @fastify/static
```

No risk to existing data (auth, todos, processed_emails tables unchanged).
