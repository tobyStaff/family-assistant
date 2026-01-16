# API Cheatsheet

Quick reference for testing Inbox Manager API endpoints.

**Note:** Most endpoints require OAuth authentication (not yet implemented). Only Health & Monitoring endpoints work without auth.

## Health & Monitoring (✅ Working Without Auth)

```bash
# Health check
curl http://localhost:3000/health

# Prometheus metrics
curl http://localhost:3000/metrics

# Trigger daily summary manually
curl http://localhost:3000/admin/trigger-daily-summary
```

## TODOs (❌ Requires Auth)

```bash
# List all TODOs
curl http://localhost:3000/todos

# Create TODO
curl -X POST http://localhost:3000/todos \
  -H "Content-Type: application/json" \
  -d '{"description":"Buy groceries","due_date":"2026-01-10T15:00:00Z","status":"pending"}'

# Get specific TODO
curl http://localhost:3000/todos/1

# Update TODO
curl -X PUT http://localhost:3000/todos/1 \
  -H "Content-Type: application/json" \
  -d '{"description":"Buy groceries and milk","status":"done"}'

# Delete TODO
curl -X DELETE http://localhost:3000/todos/1

# Mark as done
curl -X PATCH http://localhost:3000/todos/1/done

# Mark as pending
curl -X PATCH http://localhost:3000/todos/1/pending
```

## Calendar (❌ Requires Auth)

```bash
# Add calendar event
curl -X POST http://localhost:3000/add-event \
  -H "Content-Type: application/json" \
  -d '{
    "summary":"Team Meeting",
    "description":"Weekly sync",
    "start":"2026-01-10T10:00:00Z",
    "end":"2026-01-10T11:00:00Z"
  }'
```

## Email Processing (❌ Requires Auth)

```bash
# Process email command
curl -X POST http://localhost:3000/process-command/email-id-123
```

## Database

```bash
# View tables
sqlite3 ./data/app.db "SELECT name FROM sqlite_master WHERE type='table';"

# View TODOs
sqlite3 ./data/app.db "SELECT * FROM todos;"

# View auth entries
sqlite3 ./data/app.db "SELECT user_id FROM auth;"

# View processed emails
sqlite3 ./data/app.db "SELECT * FROM processed_emails;"
```

## Docker

```bash
# Build image
docker-compose build

# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Execute in container
docker exec -it inbox-manager node dist/scripts/backupDb.js
```

## Deployment

```bash
# Deploy to Digital Ocean
./deploy.sh DROPLET_IP

# SSH to server
ssh root@DROPLET_IP

# View production logs
ssh root@DROPLET_IP 'cd /app/inbox-manager && docker-compose logs -f'

# Check backup logs
ssh root@DROPLET_IP 'tail -f /var/log/inbox-backup.log'
```

## Development

```bash
# Start dev server
pnpm dev

# Run tests
pnpm test

# Type check
pnpm typecheck

# Build
pnpm build

# Start production
pnpm start
```
