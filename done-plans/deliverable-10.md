### Detailed Implementation for Deliverable 10: Deployment (Dockerized)

As the lead web engineer, let's wrap up the MVP with Deliverable 10. This focuses on a seamless, one-command deployment to Digital Ocean, ensuring portability, auto-restarts, nightly DB backups to Google Drive, and basic monitoring via metrics. Building on Deliverable 1's Docker setup, this keeps ops minimal while meeting the plan's $5/mo budget and stability goals. We'll use TypeScript for any custom scripts (e.g., backup), but bash for deployment simplicity—it's better suited for shell tasks like SSH/copy/run. If we needed advanced CI/CD (e.g., GitHub Actions), I'd recommend Python for orchestration scripts due to its robust libraries like paramiko for SSH, but that's beyond MVP scope; manual one-command is fine here.

Before diving in, let's evaluate 2-3 options for the deployment strategy, as trade-offs are crucial:

1. **Option A: Manual SSH + Docker-Compose (Chosen in Plan)**  
   - Provision Droplet via DO CLI/UI, SSH to copy files/set ENV, run docker-compose up -d. Add a cron for backup script.  
   - Pros: Zero extra tools, pure Docker for portability, quick setup (1 day). Fits minimalism—no CI overhead.  
   - Cons: Manual steps prone to human error; scaling to multiple envs requires repetition.  
   - Trade-off: Ideal for MVP—low LOC (simple scripts), hands-on control. Ensures "one-command" via a deploy.sh wrapper.

2. **Option B: Terraform for Infra + Docker-Compose**  
   - Use Terraform (HCL) to provision Droplet, then Ansible/Python for config/deploy.  
   - Pros: Infra-as-code for reproducibility, easy env spins (dev/staging/prod). Better for team handoffs.  
   - Cons: Adds deps (Terraform install), more LOC/learning (~50-100 for configs), exceeds 1-day effort. Not needed for single Droplet.  
   - Trade-off: Enhances long-term ops but bloats MVP. Skip unless anticipating multi-region deploys.

3. **Option C: DO App Platform (Serverless-ish)**  
   - Use DO's App Platform to deploy containerized app directly from Git, auto-handles restarts/metrics.  
   - Pros: No manual provisioning, built-in monitoring/backups, scales auto. Less ops.  
   - Cons: Higher cost (~$12/mo min), less control over VM (no custom cron/SQLite volume), deviates from plan's Droplet. Potential vendor lock.  
   - Trade-off: Simplifies but increases budget/locks in—avoid for cost-conscious MVP.

**Decision**: Stick with Option A—manual SSH with Docker-Compose. It's the simplest, aligns with the plan's portability and budget, and minimizes bugs by keeping steps scriptable. We can automate more post-MVP if needed.

Now, the implementation. We'll provide key files/snippets: Dockerfile (from Deliverable 1, refined), docker-compose.yml, deploy.sh (bash for one-command), backup script (TS for Drive integration), and metrics setup. Assume repo structure: root with Dockerfile, docker-compose.yml, src/. Provisioning via DO dashboard or doctl CLI (install: brew install doctl).

#### 1. Provision the Droplet
- Use DO dashboard: Create $5/mo Droplet (1GB RAM, Ubuntu 22.04, Docker pre-installed image).
- Or CLI: `doctl compute droplet create inbox-mvp --image docker-20-04 --size s-1vcpu-1gb --region nyc1 --ssh-keys YOUR_SSH_KEY_ID`.
- Add firewall: Allow SSH (22), HTTP (80/443 if needed), app port (3000).
- SSH as root: `ssh root@DROPLET_IP`.

#### 2. Dockerfile (Refined for Production)
Build on Node Alpine for lightweight (~100MB image).

```dockerfile
# src/Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install deps
COPY package*.json ./
RUN npm ci --production

# Copy source
COPY . .

# Build TS
RUN npm run build  # Assuming tsconfig with "build": "tsc"

# Expose port
EXPOSE 3000

# Run with heap limit for micro-VM
CMD ["node", "--max-old-space-size=512", "dist/app.js"]
```

- **Notes**: 
  - Production deps only; build step for TS to JS.
  - Heap limit prevents OOM—tune via metrics.

#### 3. docker-compose.yml (With Volumes, Restart, Metrics)
Maps SQLite volume, sets ENV, auto-restart.

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build: .
    ports:
      - '3000:3000'
    volumes:
      - db-data:/app/data  # Persist SQLite
    environment:
      - NODE_ENV=production
      - ENCRYPTION_KEY=your_secure_key  # Set via .env or CLI
      - AI_API_KEY=sk-...
      - GOOGLE_CLIENT_ID=...
      - GOOGLE_CLIENT_SECRET=...
      - DB_PATH=/app/data/app.db
      - AI_PROVIDER=openai
    restart: always  # Auto-restart on fail/reboot
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  db-data:
```

- **Notes**: 
  - Restart: 'always' meets plan.
  - Healthcheck: Add /health route in app.ts for liveness.
  - ENV: Sensitive—use DO's secrets or .env (git ignored).

#### 4. Metrics Setup (fastify-metrics)
In app.ts: Install `npm i fastify-metrics prometheus-client`.

```typescript
// src/app.ts (snippet)
import fastifyMetrics from 'fastify-metrics';
import { registry } from 'prometheus-client'; // Default registry

await app.register(fastifyMetrics, { endpoint: '/metrics' });

// Custom metrics example
const heapGauge = new registry.Gauge({
  name: 'node_heap_usage_bytes',
  help: 'Heap memory usage',
});
setInterval(() => {
  heapGauge.set(process.memoryUsage().heapUsed);
}, 10000);
```

- **Notes**: 
  - Exposes /metrics: Requests, heap, etc.
  - For advanced, integrate with DO Monitoring or Prometheus.

#### 5. Backup Script (Nightly to Drive)
TS script using googleapis, run via cron.

```typescript
// src/scripts/backupDb.ts
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { Auth } from 'google-auth-library'; // App auth (service account for server)

async function backupToDrive() {
  const auth = new google.auth.GoogleAuth({
    keyFile: '/app/credentials.json', // Mount in Docker
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  const client = await auth.getClient();
  const drive = google.drive({ version: 'v3', auth: client });

  const dbBuffer = readFileSync(process.env.DB_PATH || '/app/data/app.db');

  const fileMetadata = { name: `app_backup_${new Date().toISOString()}.db` };
  const media = { mimeType: 'application/octet-stream', body: dbBuffer };

  await drive.files.create({ resource: fileMetadata, media });
}

backupToDrive().catch(console.error);
```

- **Notes**: 
  - Service account for server-side (no user OAuth).
  - Cron: In Droplet, `crontab -e`: `0 2 * * * docker exec app-container node /app/dist/scripts/backupDb.js`.
  - Mount credentials.json in docker-compose.

#### 6. One-Command Deploy Script (Bash)
Wrapper for "one-command" deploy.

```bash
#!/bin/bash
# deploy.sh (run locally)

DROPLET_IP=$1  # Pass as arg
if [ -z "$DROPLET_IP" ]; then echo "Usage: ./deploy.sh DROPLET_IP"; exit 1; fi

# Copy files
scp -r . root@$DROPLET_IP:/app  # Or use rsync for efficiency
scp .env root@$DROPLET_IP:/app  # Secrets

# SSH and run
ssh root@$DROPLET_IP << EOF
  cd /app
  docker-compose down
  docker-compose up -d --build
  # Setup cron if not exists
  (crontab -l 2>/dev/null; echo "0 2 * * * docker exec -it \$(docker ps -qf name=app) node dist/scripts/backupDb.js") | crontab -
EOF
```

- **Notes**: 
  - Run: `./deploy.sh YOUR_IP`.
  - Assumes SSH key setup.
  - Builds on server for simplicity.

#### 7. Testing Approach (Expanded)
- Reboot: `ssh root@IP reboot`, wait, check `docker ps` (app running), query DB (data persists).
- Metrics: `curl http://IP:3000/metrics`—assert heap/requests output.
- Backup: Manual run script, check Drive for .db file.
- Full E2E: Deploy, send test email, process, verify actions/TODOs/events.

This completes Deliverable 10—portable, observable (~50 LOC/scripts). MVP ready for launch in under 2 weeks! If scaling, consider Kubernetes, but this fits perfectly.