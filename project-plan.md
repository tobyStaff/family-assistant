Inbox Manager: Architect-Approved MVP Project Plan (Updated v2)
Overview
This plan targets a high-stability, low-maintenance MVP. We retain the Digital Ocean Droplet ($5/mo) + SQLite strategy but upgrade the implementation details to ensure the application doesn't crash on low-memory hardware and remains portable. This update incorporates refinements for better security, usability, and maintainability based on the latest review, including enhanced encryption key derivation, explicit library choices (e.g., date-fns-tz for timezones), expanded keyword matching in parsing, a selected AI provider with switchability, a dedicated auth table, and minor deployment tweaks—all while keeping effort under 2 weeks and code minimal.

Key parsing refinements: AI (e.g., OpenAI gpt-3.5-turbo) is now the primary mode for general email content processing to extract semantics like importance, urgency, actions, and dates from unstructured text. NLP (chrono-node + keyword matching) is retained specifically for direct command processing (e.g., emails with explicit "#todo" or similar). Attachments are saved to Drive via streaming but not analyzed/extracted for now (defer to future iterations). Calendar event addition includes duplicate prevention via fuzzy matching to avoid re-adding similar events.

Scalability Considerations
- **User Capacity**: This setup is estimated to support 500-2,000 unique user accounts comfortably, assuming low activity (e.g., daily emails and occasional fetches). This leverages SQLite's efficiency for small records, with proper indexing on user_id in tables to maintain performance. For higher volumes, consider migrating to PostgreSQL.
- **Concurrent Users**: Handles 5-20 concurrent users effectively, given the I/O-bound nature of operations and WAL mode for DB concurrency. Monitor with fastify-metrics and tune Node.js heap size if needed; upgrade hardware for more.
- **Tenancy Model**: Multi-tenant by default, with all users sharing a single DB instance isolated by user_id filters in queries. This is cost-efficient and simple for MVP. For stricter isolation (e.g., regulatory needs), deploy per-user instances as a single-tenant variant, though this increases costs.
Core Architectural Changes:
* Containerization: The app will run in Docker. This eliminates "it works on my machine" issues and simplifies the server setup to a single command.
* Memory Safety: Attachments are handled via Node.js Streams (pipes), not Buffers, preventing Out-Of-Memory (OOM) crashes on the micro-VM.
* Data Integrity: SQLite will run in WAL (Write-Ahead Log) Mode for concurrency. OAuth tokens will be AES-256 encrypted at rest.
* Time: All database timestamps in UTC; User interactions converted to local time via date-fns-tz.
* Parsing Router: A simple keyword scan routes emails to NLP for commands or AI for semantic content extraction, ensuring optimal speed and accuracy.
Deliverables Breakdown
1. Project Setup, Docker & Secure Auth
Goal: Scaffold a portable Fastify app with secure Google OAuth storage.
Key Tasks:
* Init TS project; add fastify, zod (validation).
* Docker: Create Dockerfile (Node Alpine) and docker-compose.yml (mapping a volume for SQLite).
* Security: Implement a helper to Encrypt/Decrypt Refresh Tokens using crypto (AES-256-CBC) before saving to DB. Derive the encryption key from an ENV var using crypto.scryptSync for added security against weak keys.
* Setup Google OAuth strategies.\
  Estimated Effort: 1-2 days.\
  Testing Approach: docker-compose up to verify boot; Unit test encryption helper; Auth flow test.
2. Email Fetching Endpoint (Rate Limit Aware)
Goal: Route to fetch new Gmail emails without getting banned.
Key Tasks:
* Use googleapis Gmail client.
* POST /fetch-emails.
* Logic: Implement simple exponential backoff for Google API 429 (Rate Limit) errors.
* Return basic email metadata (snippet, sender, date).\
  Estimated Effort: 1-2 days.\
  Testing Approach: Mock 429 errors to ensure retry logic works.
3. Modular Email Parser (NLP Mode for Commands)
Goal: Deterministic extraction for explicit command emails using established libraries.
Key Tasks:
* Interface IParser with router logic.
* Dates: Use chrono-node for robust date parsing (e.g., "Next Tuesday", "Tomorrow @ 5"). Do not write date regexes.
* Logic: Strict keyword matching for commands via a configurable array (e.g., ['#todo', '#task', '#cal']) to handle common variations. Router scans for these keywords to invoke NLP.\
  Estimated Effort: 1 day.\
  Testing Approach: Unit tests feeding chrono-node various date formats; Validate keyword array with Zod.
4. Modular Email Parser (AI Mode for Content)
Goal: Primary parsing for unstructured natural language to extract semantics.
Key Tasks:
* Integration with OpenAI SDK (gpt-3.5-turbo for cost efficiency), configurable via ENV var (AI_PROVIDER) for easy switch to alternatives like Anthropic.
* Prompt Engineering: Force JSON output for predictable parsing, including fields like { importance: 'high/medium/low', urgency: 'immediate/short-term/long-term', actions: [{description, dueDate}], dates: [{event, start, end, timezone}] }.
* Cost Control: Limit token count per request.
* Router: Invoke AI if no command keywords detected.\
  Estimated Effort: 1 day.\
  Testing Approach: Verify JSON schema validation on AI output; Mock prompts for semantic extraction.
5. Attachment Saver (Streaming)
Goal: Save attachments to Drive with near-zero RAM footprint.
Key Tasks:
* Critical: Create a Pass-Through Stream.
  * Read Stream: gmail.users.messages.attachments.get({ alt: 'media' })
  * Write Stream: drive.files.create({ media: { body: stream } })
* Route /save-attachment/:emailId. (No analysis/extraction for now—defer to future.)\
  Estimated Effort: 1-2 days.\
  Testing Approach: Upload a file larger than the VM's RAM (e.g., 500MB dummy file) to verify no crash.
6. Calendar Event Adder (Timezone Aware with Dedup)
Goal: Add parsed events to Google Calendar, preventing duplicates.
Key Tasks:
* Route /add-event.
* Timezones: Ensure chrono-node or AI output is converted to the user's config timezone before sending to Google Calendar API.
* Dedup: Before insert, query calendar.events.list for similar events in a ±1 day window using fuzzy matching (e.g., string similarity on title/description via 'string-similarity' lib and date overlap checks). Skip if match found.\
  Estimated Effort: 1-2 days.\
  Testing Approach: Test "Tomorrow at 9am" from different mock user timezones; Simulate duplicate events and assert skip.
7. TODO List Manager (SQLite WAL)
Goal: High-performance local CRUD for tasks.
Key Tasks:
* Install better-sqlite3.
* Config: Enable WAL mode: db.pragma('journal_mode = WAL'); on startup.
* Create todos table; Use a separate auth table for encrypted tokens to maintain separation of concerns. Add indexes on user_id for both tables to support multi-tenancy efficiently.\
  Estimated Effort: 1 day.\
  Testing Approach: Concurrent read/write script to ensure no database locking errors.
8. Self-Email Command Processor
Goal: Orchestrator for the "Email Ops" workflow.
Key Tasks:
* Route /process-command/:emailId.
* Logic: Fetch -> Parse (Route to NLP if commands detected via keyword scan, else AI for semantics) -> Execute Action (Calendar/Todo/Drive).
* Idempotency: Check if emailId has already been processed in DB to prevent duplicate actions.\
  Estimated Effort: 2 days.\
  Testing Approach: Send the same email ID twice; assert action only happens once. Test router with command vs. content emails.
9. Daily Summary (Robust Cron)
Goal: Send daily digests reliably.
Key Tasks:
* Use fastify-cron.
* Logic: Query Calendar/TODOs for the next 24h.
* Format HTML email (with text fallback for compatibility).
* Safety: Wrap in try/catch block to ensure a cron failure doesn't crash the server.\
  Estimated Effort: 1-2 days.\
  Testing Approach: Manually trigger cron function; verify email rendering.
10. Deployment (Dockerized)
Goal: One-command deployment to Digital Ocean.
Key Tasks:
* Provision Droplet ($5/mo, Docker pre-installed image).
* Set ENV variables (Encryption Key, API Keys).
* Copy docker-compose.yml to server.
* Run docker-compose up -d.
* Backup: Add a simple script to copy the SQLite .db file to Google Drive nightly.
* Auto-Restart: Configure Docker restart policy as 'always' in docker-compose.yml.
* Monitoring: Install fastify-metrics and expose /metrics endpoint for basic observability (e.g., requests, heap usage).\
  Estimated Effort: 1 day.\
  Testing Approach: Reboot the Droplet and ensure the app auto-restarts and data persists; Query /metrics to verify output.
  
  
Technical Trade-offs & Decisions
| Decision | Alternative | Why we chose this (Architect View) |
|----------|-------------|------------------------------------|
| Docker Compose | Bare Metal / PM2 | Portability & Recovery. If the server dies, we can spin up a new one in 5 mins. |
| Streams | Buffers | Stability. Prevents OOM crashes on cheap hardware. |
| chrono-node | Regex | Accuracy. Date parsing is too hard to hand-roll; reduces bugs significantly. |
| SQLite WAL | Standard SQLite | Concurrency. Allows reading the summary while writing a new TODO without locking. |
| Encrypted Auth | Plaintext Auth | Security. Protects user's entire Google account if the DB is leaked. |
| OpenAI (gpt-3.5-turbo) | Anthropic Claude | Cost Efficiency. Lower per-token costs for MVP, with ENV switch for alternatives if reliability needs tweaking. |
| Multi-Tenancy | Single-Tenancy | Simplicity & Cost. Shared DB with user_id isolation minimizes ops and fits $5/mo budget; switch to per-user deploys for high-isolation needs. |
| AI-Primary with NLP for Commands | NLP-Primary or AI-Only | Balance. AI excels at semantics for unstructured content; NLP keeps commands fast/deterministic. Simple router adds minimal LOC. |
| Fuzzy Calendar Dedup | Hash-Based or None | Reliability. Prevents clutter from similar events; API query is low-cost for MVP, with lightweight string-similarity for accuracy. |