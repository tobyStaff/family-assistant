# Updated Deliverable 1: Project Setup, Docker & Secure Auth

As a lead engineer, I've updated the original plan by incorporating the recommended improvements. This keeps the core structure intact for familiarity but integrates refinements for better security, maintainability, and efficiency. Key changes include switching to pnpm for faster dependency management, adding Vitest for scalable testing, enhancing encryption with dynamic salt, wrapping DB in async for future-proofing, using multi-stage Docker builds, and adding CSRF protection to OAuth routes. These additions increase robustness without unnecessary complexity—total estimated LOC increase is ~100, but it reduces future refactoring needs. Effort bumps slightly to 1.5-2.5 days to account for testing setup.

The updates prioritize minimalism: e.g., async DB wrapper is a thin layer, and CSRF uses existing @fastify/cookie. Where tradeoffs arose (e.g., sync vs. async DB), I chose options that scale without overcomplicating the initial sprint.

**Objective**: Establish the application foundation. By the end of this sprint, you will have a running Fastify server inside Docker that can authenticate a user via Google, receive an OAuth Access/Refresh token, and store the Refresh token securely (encrypted) in a local SQLite database.

**Estimated Effort**: 1.5-2.5 Days

**Success Metric**: Running docker-compose up starts the server. Visiting http://localhost:3000/auth/login redirects to Google, and after login, a row appears in the SQLite auth table with an encrypted token.

## 1. Repository & Tech Stack Initialization
**Context**: Initialize the project with strict TypeScript configurations to prevent future bugs. We've switched to pnpm for faster installs and stricter dependency handling, added Vitest for proper unit testing, and included @types/better-sqlite3 for full TS support. Folder structure now includes a /tests dir to keep src clean.

* 1.1. Initialize Node Project:
  * Run pnpm init.
  * Install Core Dependencies: fastify, @fastify/env (env var validation), @fastify/cookie, zod (validation), better-sqlite3, @types/better-sqlite3, googleapis, dotenv.
  * Install Dev Dependencies: typescript, tsx (for running TS directly), @types/node, pino-pretty (logging), vitest.

* 1.2. Configure TypeScript (tsconfig.json):
  * Target: ES2022.
  * Module: NodeNext.
  * Strict: true (Crucial for junior devs/AI to catch nulls).

* 1.3. Define Folder Structure:
  * Enforce this structure to keep the project modular:
    ```
    /src
      /config      # Env vars & constants
      /db          # SQLite connection & schema migrations
      /lib         # Shared utilities (crypto, logger)
      /routes      # Fastify route definitions
      /types       # TS Interfaces
      app.ts       # App entry point
    /data          # Volume mount for SQLite (gitignored)
    /tests         # Unit and integration tests
    Dockerfile
    docker-compose.yml
    ```

* 1.4. Env Validation (src/config/env.ts):
  * Use @fastify/env with Zod to define and validate all env vars (e.g., ENCRYPTION_SECRET, GOOGLE_CLIENT_ID, etc.) at startup. Schema example:
    ```typescript
    import { z } from 'zod';
    export const envSchema = z.object({
      ENCRYPTION_SECRET: z.string().min(16),
      // Add Google creds, etc.
    });
    ```

## 2. Security Module (Encryption Helper)
**Context**: We strictly avoid storing plain-text tokens. If the DB is leaked, the attacker should only see garbage data without the ENV key. Updated to use a random salt generated on first boot (stored in env or a file) for better key derivation security. Tests now use Vitest for easier expansion.

* 2.1. Create src/lib/crypto.ts:
  * Requirements:
    * Algorithm: aes-256-cbc.
    * Key Derivation: Use crypto.scryptSync to derive a 32-byte key from the ENCRYPTION_SECRET env var + a random salt (generate if not exists, e.g., via fs).
    * IV (Initialization Vector): Generate a random 16-byte IV for every encryption operation.
  * Functions:
    * encrypt(text: string): { iv: string, encryptedData: string }
    * decrypt(encryptedData: string, iv: string): string
  * Error Handling: Throw if ENCRYPTION_SECRET missing (validated via env schema).

* 2.2. Validation: Write tests/tests/lib/crypto.test.ts using Vitest. Assert decrypt(encrypt("test")) === "test", plus edge cases (empty string, long input).

## 3. Database Layer (SQLite Scaffold)
**Context**: Set up the database connection in WAL mode for concurrency and create the initial Auth table. Updated to wrap better-sqlite3 in promises for async compatibility with Fastify routes. Added a simple migration version table for schema evolution. Switched timestamps to CURRENT_TIMESTAMP for simplicity.

* 3.1. Database Initialization (src/db/index.ts):
  * Initialize better-sqlite3 connecting to ./data/inbox.db.
  * Crucial: Execute db.pragma('journal_mode = WAL'); immediately upon connection.
  * Wrap connection in async (e.g., via util.promisify or custom async methods) for await usage in routes.

* 3.2. Schema Migration:
  * Create a function initDb() that runs on startup, checking a migrations table (e.g., CREATE TABLE IF NOT EXISTS migrations (version INTEGER)).
  * If version < 1, run the Auth schema and set version=1.
  * SQL Schema:
    ```
    CREATE TABLE IF NOT EXISTS auth (
        user_id TEXT PRIMARY KEY,       -- Google's sub from ID token for uniqueness
        email TEXT NOT NULL,
        refresh_token_enc TEXT NOT NULL,-- The encrypted blob
        refresh_token_iv TEXT NOT NULL, -- The IV used for encryption
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_auth_email ON auth(email);
    ```

* 3.3. Data Dir Safety: On boot, fs.mkdirSync('./data', { recursive: true }).

## 4. Containerization (Docker)
**Context**: Ensure the app runs identically on your machine and the cheap Digital Ocean droplet. Updated to multi-stage Dockerfile for smaller images, added restart policy in compose.

* 4.1. Create Dockerfile:
  * Multi-stage: Build stage installs deps, runtime stage copies to node:20-alpine.
  * Workdir: /app.
  * User: node (Don't run as root for security).
  * Expose: 3000.
  * Cmd: tsx src/app.ts (for dev; use node dist/app.js for prod if building).

* 4.2. Create docker-compose.yml:
  * Map port 3000:3000.
  * Volume Mapping: ./data:/app/data (This persists the SQLite DB outside the container).
  * Env File: .env.
  * Restart: unless-stopped.

## 5. Google OAuth Implementation
**Context**: The entry point for user onboarding. Added CSRF protection via state param and signed cookie for security. Use Google's sub as user_id. Handle errors in callback.

* 5.1. Google Cloud Console Setup (Prerequisite):
  * Create Project -> Enable Gmail API, Google Drive API, Calendar API.
  * Create OAuth Credentials (Web Application).
  * Redirect URI: http://localhost:3000/auth/callback.

* 5.2. Fastify Routes (src/routes/auth.ts):
  * GET /auth/login:
    * Generate random state, store in signed cookie via @fastify/cookie.
    * Generate Google OAuth URL with access_type: 'offline' (Critical for Refresh Token), prompt: 'consent', and include state.
    * Scopes: https://www.googleapis.com/auth/gmail.readonly, https://www.googleapis.com/auth/calendar, https://www.googleapis.com/auth/drive.file.
  * GET /auth/callback:
    * Verify state from query vs. cookie (throw if mismatch).
    * Extract code from query param.
    * Exchange code for Tokens using googleapis; use sub from ID token as user_id.
    * Action: Encrypt the refresh_token using src/lib/crypto.ts.
    * Action: INSERT OR REPLACE into the auth table (use async DB methods).
    * Error Handling: Try-catch; log with pino, redirect to error if fails.
    * Response: Return a simple HTML "Login Successful. You can close this tab."

## Implementation Guide (Cheatsheet for the Developer)
A. Encryption Logic (Strict Adherence Required)
Updated pattern with random salt:
```typescript
import crypto from 'node:crypto';
import fs from 'node:fs';

const SALT_PATH = './data/crypto_salt'; // Persist salt
let salt = fs.existsSync(SALT_PATH) ? fs.readFileSync(SALT_PATH) : crypto.randomBytes(16);
if (!fs.existsSync(SALT_PATH)) fs.writeFileSync(SALT_PATH, salt);

const ALGORITHM = 'aes-256-cbc';
const KEY = crypto.scryptSync(process.env.ENCRYPTION_SECRET!, salt, 32);

export function encrypt(text: string) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return { 
     iv: iv.toString('hex'), 
     content: encrypted.toString('hex') 
  };
}

// Implement decrypt similarly...
```

B. Handling Google "429" & Refresh Tokens
* Note: We are not implementing the "Rate Limit" logic (Deliverable 2) yet, but we must ensure we request access_type: 'offline' in this step. If you miss this, Google will not send a refresh token, and the app will break after 1 hour.

C. Logging
* Create src/lib/logger.ts with pino (child logger for modules). Use in routes/db for errors/info.

## Acceptance Tests (QA)
1. Boot Test: Run docker-compose up --build. The logs should show Fastify listening on 0.0.0.0:3000.

2. Persistence Test:
   * Login via localhost:3000/auth/login.
   * Stop the container (Ctrl+C).
   * Start the container again.
   * Check the DB manually (using a tool like DB Browser for SQLite on the ./data/inbox.db file) to confirm the user record still exists.

3. Security Test: Open the .db file. The refresh_token column should be a random hex string, not a readable Google token (starts with 1//...).

4. Unit Tests: Run vitest—ensure crypto tests pass.

5. CSRF Test: Manually tamper with state param in callback URL; should fail validation.

## Next Step
Would you like me to generate the updated Dockerfile and docker-compose.yml content, or perhaps sample code for the async DB wrapper?

