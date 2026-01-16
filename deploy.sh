#!/bin/bash
# deploy.sh - One-command deployment to Digital Ocean Droplet
#
# Usage: ./deploy.sh DROPLET_IP
#
# Prerequisites:
#   - Digital Ocean Droplet with Docker installed
#   - SSH key configured for root access
#   - .env file with secrets in project root

set -e  # Exit on any error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Validate arguments
if [ -z "$1" ]; then
  log_error "Usage: ./deploy.sh DROPLET_IP"
  exit 1
fi

DROPLET_IP=$1
REMOTE_USER=${REMOTE_USER:-root}
REMOTE_PATH=${REMOTE_PATH:-/app/inbox-manager}

log_info "Starting deployment to $DROPLET_IP"

# Validate .env file exists
if [ ! -f ".env" ]; then
  log_error ".env file not found! Please create one with required environment variables."
  exit 1
fi

# Test SSH connection
log_info "Testing SSH connection..."
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$REMOTE_USER@$DROPLET_IP" exit 2>/dev/null; then
  log_error "Cannot connect to $DROPLET_IP via SSH. Please check your SSH keys and firewall settings."
  exit 1
fi
log_info "✓ SSH connection successful"

# Build locally first
log_info "Building application locally..."
if ! pnpm build; then
  log_error "Local build failed. Please fix TypeScript errors first."
  exit 1
fi
log_info "✓ Build completed"

# Sync files to server (includes dist, excludes src and node_modules)
log_info "Syncing files to server..."
rsync -av --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'data' \
  --exclude '*.log' \
  --exclude 'coverage' \
  --exclude '.DS_Store' \
  --exclude '*.db' \
  --exclude '*.db-shm' \
  --exclude '*.db-wal' \
  --exclude 'src' \
  --exclude 'tsconfig.json' \
  ./ "$REMOTE_USER@$DROPLET_IP:$REMOTE_PATH/"

log_info "✓ Files synced successfully"

# Copy .env file separately (contains secrets)
log_info "Copying .env file..."
scp .env "$REMOTE_USER@$DROPLET_IP:$REMOTE_PATH/.env"
log_info "✓ .env copied"

# Copy credentials.json if it exists (for Google Drive backups)
if [ -f "credentials.json" ]; then
  log_info "Copying Google service account credentials..."
  scp credentials.json "$REMOTE_USER@$DROPLET_IP:$REMOTE_PATH/credentials.json"
  log_info "✓ Credentials copied"
else
  log_warn "credentials.json not found - Google Drive backups will not work"
fi

# Deploy on server
log_info "Deploying application on server..."
ssh "$REMOTE_USER@$DROPLET_IP" << 'EOF'
  set -e

  cd /app/inbox-manager

  echo "[SERVER] Stopping existing containers..."
  docker compose down || true

  echo "[SERVER] Building and starting containers..."
  docker compose up -d --build

  echo "[SERVER] Waiting for application to start..."
  sleep 5

  echo "[SERVER] Checking container status..."
  docker compose ps

  echo "[SERVER] Checking application health..."
  if curl -f http://localhost:3000/health >/dev/null 2>&1; then
    echo "[SERVER] ✓ Application is healthy"
  else
    echo "[SERVER] ✗ Health check failed - checking logs..."
    docker compose logs --tail=50 app
    exit 1
  fi

  echo "[SERVER] Setting up backup cron job..."
  # Check if cron job already exists
  if crontab -l 2>/dev/null | grep -q "backupDb.js"; then
    echo "[SERVER] Backup cron job already exists"
  else
    # Add cron job: Run backup nightly at 2 AM
    (crontab -l 2>/dev/null; echo "0 2 * * * docker exec inbox-manager node dist/scripts/backupDb.js >> /var/log/inbox-backup.log 2>&1") | crontab -
    echo "[SERVER] ✓ Backup cron job installed (runs daily at 2 AM)"
  fi

  echo "[SERVER] Deployment completed successfully!"
EOF

log_info "✓ Deployment successful!"
log_info ""
log_info "Application URLs:"
log_info "  Health Check:    http://$DROPLET_IP:3000/health"
log_info "  Metrics:         http://$DROPLET_IP:3000/metrics"
log_info "  OAuth Callback:  http://$DROPLET_IP:3000/auth/google/callback"
log_info ""
log_info "Useful commands:"
log_info "  View logs:       ssh $REMOTE_USER@$DROPLET_IP 'cd $REMOTE_PATH && docker compose logs -f'"
log_info "  Restart:         ssh $REMOTE_USER@$DROPLET_IP 'cd $REMOTE_PATH && docker compose restart'"
log_info "  Stop:            ssh $REMOTE_USER@$DROPLET_IP 'cd $REMOTE_PATH && docker compose down'"
log_info "  Manual backup:   ssh $REMOTE_USER@$DROPLET_IP 'docker exec inbox-manager node dist/scripts/backupDb.js'"
log_info ""
log_info "Next steps:"
log_info "  1. Configure firewall to allow port 3000 (or setup nginx reverse proxy)"
log_info "  2. Test OAuth flow with Google Calendar and Gmail"
log_info "  3. Monitor metrics at http://$DROPLET_IP:3000/metrics"
log_info "  4. Check backup logs: ssh $REMOTE_USER@$DROPLET_IP 'tail -f /var/log/inbox-backup.log'"
