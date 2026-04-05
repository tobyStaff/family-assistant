# Manual Testing

## Prerequisites

**Session cookie** — get from browser DevTools while logged in as an admin:
DevTools → Application → Cookies → `session_id` → copy the Value

```bash
export SESSION_COOKIE="session_id=<copied-value>"
```

**User ID** — query the local DB:
```bash
sqlite3 ./data/inbox.db "SELECT user_id, email FROM users;"
```

---

## Gmail users

```bash
./scripts/fire-cron.sh daily-email-fetch
./scripts/fire-cron.sh daily-email-analysis
./scripts/fire-cron.sh daily-summary --force
```

---

## Hosted email users

The inbound webhook is triggered by the Lambda in production. Locally, use `seed-inbound` to replay emails from the S3 bucket via the same webhook.

```bash
# 1. Pull all emails from S3 and seed them via the local webhook
pnpm seed-inbound --s3-all

# Filter to a specific alias to avoid replaying other users' emails
pnpm seed-inbound --s3-all --alias toby

# 2. Run AI analysis on the stored emails
./scripts/fire-cron.sh daily-email-analysis

# 3. Send the summary email
./scripts/fire-cron.sh daily-summary --force
```

---

## Options

**Single user only:**
```bash
./scripts/fire-cron.sh daily-summary --force --user <userId>
```

**Against production:**
```bash
BASE_URL=https://getfamilyassistant.com SESSION_COOKIE="session_id=xxx" \
  ./scripts/fire-cron.sh daily-summary --force
```

**Other jobs:**
```bash
./scripts/fire-cron.sh onboarding-sequence
./scripts/fire-cron.sh event-sync-retry
```
