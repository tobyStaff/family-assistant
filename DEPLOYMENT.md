# Deployment Guide: Digital Ocean $5 Droplet

Complete step-by-step instructions for deploying the Inbox Manager to a Digital Ocean droplet.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Step 1: Create Digital Ocean Droplet](#step-1-create-digital-ocean-droplet)
3. [Step 2: Configure SSH Access](#step-2-configure-ssh-access)
4. [Step 3: Server Initial Setup](#step-3-server-initial-setup)
5. [Step 4: Install Docker](#step-4-install-docker)
6. [Step 5: Configure Google Cloud OAuth](#step-5-configure-google-cloud-oauth)
7. [Step 6: Configure Environment Variables](#step-6-configure-environment-variables)
8. [Step 7: Deploy the Application](#step-7-deploy-the-application)
9. [Step 8: Post-Deployment Configuration](#step-8-post-deployment-configuration)
10. [Maintenance & Troubleshooting](#maintenance--troubleshooting)

---

## Prerequisites

Before starting, ensure you have:

- Digital Ocean account with payment method added
- SSH key pair on your local machine
- Google account for OAuth setup
- OpenAI or Anthropic API key
- Basic command line knowledge

---

## Step 1: Create Digital Ocean Droplet

### 1.1 Create a New Droplet

1. Log in to [Digital Ocean](https://cloud.digitalocean.com)
2. Click **"Create"** → **"Droplets"**
3. Configure the droplet:
   - **Image**: Ubuntu 22.04 (LTS) x64
   - **Droplet Type**: Basic
   - **CPU Options**: Regular - $6/month (1 GB / 1 CPU)
     - *Note: The $5 tier has been replaced with $6 tier. You can also use the $4 tier but 512MB RAM is tight for Node.js + Docker*
   - **Datacenter Region**: Choose closest to your users (e.g., New York, San Francisco, London)
   - **Authentication**: SSH Key (recommended) or Password
   - **Hostname**: `inbox-manager` (or your preferred name)

4. Click **"Create Droplet"**
5. Wait 1-2 minutes for droplet creation
6. **Copy the IP address** (e.g., `123.456.789.012`)

### 1.2 Configure Firewall (Optional but Recommended)

1. In Digital Ocean dashboard, go to **Networking** → **Firewalls**
2. Click **"Create Firewall"**
3. Configure rules:
   - **Inbound Rules**:
     - SSH: TCP, Port 22, All IPv4/IPv6
     - HTTP: TCP, Port 80, All IPv4/IPv6 (if using nginx)
     - Custom: TCP, Port 3000, All IPv4/IPv6 (for direct access)
   - **Outbound Rules**: Allow all
4. Apply firewall to your droplet

---

## Step 2: Configure SSH Access

### 2.1 If Using SSH Key (Recommended)

**Generate SSH key** (if you don't have one):

```bash
ssh-keygen -t ed25519 -C "your_email@example.com"
```

Press Enter to accept default location (`~/.ssh/id_ed25519`)

**Add SSH key to Digital Ocean**:

1. Copy your public key:
   ```bash
   cat ~/.ssh/id_ed25519.pub
   ```
2. In Digital Ocean dashboard: **Settings** → **Security** → **Add SSH Key**
3. Paste the public key and save

### 2.2 Test SSH Connection

```bash
ssh root@YOUR_DROPLET_IP
```

Replace `YOUR_DROPLET_IP` with your actual IP address.

If prompted, type `yes` to add the host to known hosts.

---

## Step 3: Server Initial Setup

SSH into your droplet:

```bash
ssh root@YOUR_DROPLET_IP
```

### 3.1 Update System Packages

```bash
apt update && apt upgrade -y
```

### 3.2 Set Timezone (Optional)

```bash
timedatectl set-timezone America/New_York
```

Replace with your preferred timezone. List available timezones:

```bash
timedatectl list-timezones
```

### 3.3 Create Application Directory

```bash
mkdir -p /app/inbox-manager
```

---

## Step 4: Install Docker

### 4.1 Install Docker

```bash
# Install prerequisites
apt install -y apt-transport-https ca-certificates curl software-properties-common

# Add Docker's official GPG key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Add Docker repository
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
apt update
apt install -y docker-ce docker-ce-cli containerd.io
```

### 4.2 Install Docker Compose

```bash
# Install Docker Compose V2
apt install -y docker-compose-plugin
```

### 4.3 Verify Installation

```bash
docker --version
docker compose version
```

You should see version numbers for both commands.

### 4.4 Enable Docker to Start on Boot

```bash
systemctl enable docker
systemctl start docker
```

---

## Step 5: Configure Google Cloud OAuth

The application uses Google OAuth for Calendar and Gmail API access.

### 5.1 Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **"Select a project"** → **"New Project"**
3. Name: `inbox-manager` (or your preference)
4. Click **"Create"**

### 5.2 Enable Required APIs

1. In the project dashboard, go to **"APIs & Services"** → **"Library"**
2. Search for and enable these APIs:
   - **Google Calendar API**
   - **Gmail API**

### 5.3 Configure OAuth Consent Screen

1. Go to **"APIs & Services"** → **"OAuth consent screen"**
2. Choose **"External"** → **"Create"**
3. Fill in required fields:
   - **App name**: Inbox Manager
   - **User support email**: Your email
   - **Developer contact**: Your email
4. Click **"Save and Continue"**
5. **Scopes**: Click **"Save and Continue"** (we'll add scopes programmatically)
6. **Test users**: Add your Gmail address
7. Click **"Save and Continue"** and **"Back to Dashboard"**

### 5.4 Create OAuth Credentials

1. Go to **"APIs & Services"** → **"Credentials"**
2. Click **"Create Credentials"** → **"OAuth client ID"**
3. Configure:
   - **Application type**: Web application
   - **Name**: Inbox Manager Web Client
   - **Authorized redirect URIs**: Add this URL:
     ```
     http://YOUR_DROPLET_IP:3000/auth/google/callback
     ```
     Replace `YOUR_DROPLET_IP` with your actual droplet IP
4. Click **"Create"**
5. **Copy the Client ID and Client Secret** - you'll need these for `.env` file

### 5.5 Optional: Service Account for Backups

If you want automated Google Drive backups:

1. Go to **"APIs & Services"** → **"Credentials"**
2. Click **"Create Credentials"** → **"Service account"**
3. Name: `inbox-manager-backup`
4. Click **"Create and Continue"**
5. Skip role and user access steps
6. Click **"Done"**
7. Click on the service account you just created
8. Go to **"Keys"** tab → **"Add Key"** → **"Create new key"**
9. Choose **JSON** format
10. Download the JSON file and save as `credentials.json` in your project root

---

## Step 6: Configure Environment Variables

### 6.1 Generate Encryption Key

On your **local machine**, generate a secure encryption key:

```bash
openssl rand -hex 32
```

Copy the output (64-character hex string).

### 6.2 Create .env File

On your **local machine**, in the project root, create `.env`:

```bash
cp .env.example .env
```

### 6.3 Edit .env File

Open `.env` and configure all required variables:

```bash
# ============================================
# Application Settings
# ============================================
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info

# ============================================
# Database
# ============================================
DB_PATH=/app/data/app.db

# ============================================
# Security
# ============================================
# REQUIRED: Use the key you generated above
ENCRYPTION_SECRET=your-64-character-hex-key-here

# ============================================
# Google OAuth
# ============================================
# From Google Cloud Console (Step 5.4)
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://YOUR_DROPLET_IP:3000/auth/google/callback

# ============================================
# AI Provider
# ============================================
# Choose OpenAI OR Anthropic (or configure both)

# Option 1: OpenAI (GPT-4o)
OPENAI_API_KEY=sk-proj-your-openai-key-here

# Option 2: Anthropic (Claude)
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key-here

# Default provider (openai or anthropic)
AI_PROVIDER=openai

# ============================================
# Cron Schedule
# ============================================
# Daily at 8:00 AM UTC (adjust as needed)
CRON_SCHEDULE=0 0 8 * * *
TZ=UTC

# ============================================
# Optional: Google Drive Backups
# ============================================
# Only if you created service account (Step 5.5)
GOOGLE_SERVICE_ACCOUNT_PATH=/app/credentials.json
# GOOGLE_DRIVE_FOLDER_ID=your-folder-id-here
```

**Important**: Replace all placeholder values with your actual credentials.

---

## Step 7: Deploy the Application

### 7.1 Make Deploy Script Executable

On your **local machine**:

```bash
chmod +x deploy.sh
```

### 7.2 Run Deployment

```bash
./deploy.sh YOUR_DROPLET_IP
```

Replace `YOUR_DROPLET_IP` with your actual IP address.

The script will:
1. Test SSH connection
2. Sync all project files to the server
3. Copy `.env` and `credentials.json` (if present)
4. Build Docker image
5. Start the application
6. Run health checks
7. Set up automated backups (cron job)

### 7.3 Verify Deployment

The script output will show:

```
✓ Deployment successful!

Application URLs:
  Health Check:    http://YOUR_IP:3000/health
  Metrics:         http://YOUR_IP:3000/metrics
  OAuth Callback:  http://YOUR_IP:3000/auth/google/callback
```

Test the health endpoint:

```bash
curl http://YOUR_DROPLET_IP:3000/health
```

You should see: `{"status":"ok"}`

---

## Step 8: Post-Deployment Configuration

### 8.1 Access the Application

Open your browser:

```
http://YOUR_DROPLET_IP:3000
```

You should see the Inbox Manager dashboard.

### 8.2 Connect Google Account

1. Click **"Connect Google Account"** or similar button
2. Sign in with your Google account
3. Grant permissions for Calendar and Gmail access
4. You'll be redirected back to the application

### 8.3 Optional: Set Up Domain Name

Instead of using the IP address, you can use a domain name.

**Prerequisites**: Own a domain and access to DNS settings

1. **Add DNS A Record**:
   - Type: `A`
   - Name: `inbox` (or `@` for root domain)
   - Value: Your droplet IP address
   - TTL: 3600

2. **Wait for DNS propagation** (5-60 minutes)

3. **Update environment variables**:
   ```bash
   # On local machine, edit .env
   GOOGLE_REDIRECT_URI=http://inbox.yourdomain.com:3000/auth/google/callback
   ```

4. **Update Google Cloud OAuth**:
   - Go to Google Cloud Console → Credentials
   - Edit your OAuth client
   - Update Authorized redirect URIs to: `http://inbox.yourdomain.com:3000/auth/google/callback`

5. **Redeploy**:
   ```bash
   ./deploy.sh YOUR_DROPLET_IP
   ```

### 8.4 Optional: Set Up Nginx Reverse Proxy

For better security and to use port 80 instead of 3000:

**On the server**:

```bash
# Install nginx
apt install -y nginx

# Create nginx configuration
cat > /etc/nginx/sites-available/inbox-manager <<'EOF'
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_IP;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

# Enable the site
ln -s /etc/nginx/sites-available/inbox-manager /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default  # Remove default site

# Test nginx configuration
nginx -t

# Restart nginx
systemctl restart nginx
systemctl enable nginx
```

Now access your app at: `http://YOUR_IP` (without port 3000)

**Update `.env` and Google OAuth redirect URI** to remove `:3000` port.

### 8.5 Optional: Set Up SSL/HTTPS with Let's Encrypt

**Prerequisites**: Domain name pointing to your droplet

```bash
# Install certbot
apt install -y certbot python3-certbot-nginx

# Obtain SSL certificate
certbot --nginx -d your-domain.com

# Follow prompts to configure HTTPS
```

Certbot will automatically:
- Generate SSL certificates
- Update nginx configuration
- Set up auto-renewal

Update `.env` and Google OAuth redirect URI to use `https://` instead of `http://`.

---

## Maintenance & Troubleshooting

### View Application Logs

```bash
ssh root@YOUR_DROPLET_IP
cd /app/inbox-manager
docker compose logs -f
```

Press `Ctrl+C` to exit.

**Note**: Uses `docker compose` (with space) for Docker Compose V2, not `docker-compose` (with hyphen).

### Restart Application

```bash
ssh root@YOUR_DROPLET_IP
cd /app/inbox-manager
docker compose restart
```

### Stop Application

```bash
ssh root@YOUR_DROPLET_IP
cd /app/inbox-manager
docker compose down
```

### Redeploy After Code Changes

On your **local machine**:

```bash
./deploy.sh YOUR_DROPLET_IP
```

### Manual Database Backup

```bash
ssh root@YOUR_DROPLET_IP
docker exec inbox-manager node dist/scripts/backupDb.js
```

View backup logs:

```bash
ssh root@YOUR_DROPLET_IP
tail -f /var/log/inbox-backup.log
```

### Check Application Health

```bash
curl http://YOUR_DROPLET_IP:3000/health
```

### View Metrics

```bash
curl http://YOUR_DROPLET_IP:3000/metrics
```

Or open in browser: `http://YOUR_DROPLET_IP:3000/metrics`

### Check Docker Container Status

```bash
ssh root@YOUR_DROPLET_IP
docker ps
```

### Access Container Shell

```bash
ssh root@YOUR_DROPLET_IP
docker exec -it inbox-manager sh
```

### Check Disk Space

```bash
ssh root@YOUR_DROPLET_IP
df -h
```

### Clear Docker Resources

If running low on disk space:

```bash
ssh root@YOUR_DROPLET_IP
docker system prune -a
```

⚠️ **Warning**: This removes all unused images and containers.

### Common Issues

#### Issue: Cannot connect via SSH

**Solution**:
- Verify SSH key is added to Digital Ocean
- Check firewall allows port 22
- Ensure you're using the correct IP address

#### Issue: Health check fails

**Solution**:
```bash
ssh root@YOUR_DROPLET_IP
cd /app/inbox-manager
docker compose logs
```

Check logs for errors. Common causes:
- Missing environment variables in `.env`
- Invalid API keys
- Port 3000 already in use

#### Issue: OAuth callback fails

**Solution**:
- Verify `GOOGLE_REDIRECT_URI` in `.env` matches Google Cloud Console
- Ensure redirect URI in Google Cloud Console is exact (no trailing slash)
- Check that your email is added as test user in OAuth consent screen

#### Issue: Out of memory

**Solution**:

The $6/month droplet has 1GB RAM. If experiencing memory issues:

1. **Reduce Node.js memory limit** (already set in Dockerfile):
   ```
   CMD ["node", "--max-old-space-size=512", "dist/app.js"]
   ```

2. **Enable swap** (temporary fix):
   ```bash
   fallocate -l 1G /swapfile
   chmod 600 /swapfile
   mkswap /swapfile
   swapon /swapfile
   echo '/swapfile none swap sw 0 0' | tee -a /etc/fstab
   ```

3. **Upgrade to $12/month droplet** (2GB RAM - recommended for production):
   - In Digital Ocean dashboard: Droplet → Resize

#### Issue: Database is locked

**Solution**:
SQLite database may be locked if multiple processes access it. Ensure only one container is running:

```bash
ssh root@YOUR_DROPLET_IP
cd /app/inbox-manager
docker compose down
docker compose up -d
```

---

## Security Best Practices

### 1. Keep System Updated

```bash
ssh root@YOUR_DROPLET_IP
apt update && apt upgrade -y
```

Run monthly or enable automatic updates:

```bash
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

### 2. Change SSH Port (Optional)

Edit SSH config:

```bash
nano /etc/ssh/sshd_config
```

Change line:
```
Port 22
```
to:
```
Port 2222
```

Restart SSH:
```bash
systemctl restart sshd
```

Update firewall and use: `ssh -p 2222 root@YOUR_IP`

### 3. Disable Root Login (Optional)

Create a non-root user:

```bash
adduser deploy
usermod -aG sudo deploy
usermod -aG docker deploy
```

Copy SSH keys:

```bash
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
```

Disable root SSH login:

```bash
nano /etc/ssh/sshd_config
```

Set:
```
PermitRootLogin no
```

Restart SSH:
```bash
systemctl restart sshd
```

Update deploy script to use `REMOTE_USER=deploy`.

### 4. Set Up Fail2Ban

Protect against brute force attacks:

```bash
apt install -y fail2ban
systemctl enable fail2ban
systemctl start fail2ban
```

---

## Monitoring

### Set Up Uptime Monitoring

Use free services to monitor uptime:

- [UptimeRobot](https://uptimerobot.com/) - Free, 50 monitors
- [Healthchecks.io](https://healthchecks.io/) - Free tier available
- [Better Uptime](https://betteruptime.com/) - Free tier

Monitor this endpoint: `http://YOUR_IP:3000/health`

### Prometheus Metrics

The application exposes Prometheus metrics at `/metrics`.

To visualize:

1. Set up [Grafana Cloud](https://grafana.com/products/cloud/) (free tier)
2. Configure Prometheus to scrape: `http://YOUR_IP:3000/metrics`
3. Import pre-built Node.js dashboards

---

## Cost Estimation

### Monthly Costs

- **Droplet**: $6/month (1GB RAM) or $12/month (2GB RAM - recommended)
- **Backups**: $1.20/month (20% of droplet cost) - optional
- **Bandwidth**: 1TB included (usually sufficient)
- **Domain**: $10-15/year (optional)

**Total**: ~$6-12/month for infrastructure

### API Costs

- **OpenAI GPT-4o**: ~$0.01-0.05 per email processed
- **Anthropic Claude**: ~$0.01-0.05 per email processed
- **Google APIs**: Free (within generous quotas)

**Estimated**: $5-20/month depending on email volume

---

## Backup & Disaster Recovery

### Automated Backups

The deployment script sets up automated backups:

- **Schedule**: Daily at 2 AM server time
- **Location**: Google Drive (if service account configured)
- **Logs**: `/var/log/inbox-backup.log`

### Manual Backup

Download database to local machine:

```bash
scp root@YOUR_DROPLET_IP:/app/inbox-manager/data/app.db ./backup-$(date +%Y%m%d).db
```

### Restore from Backup

```bash
# Upload backup to server
scp ./backup-20260113.db root@YOUR_DROPLET_IP:/app/inbox-manager/data/app.db

# Restart application
ssh root@YOUR_DROPLET_IP 'cd /app/inbox-manager && docker compose restart'
```

### Snapshot Entire Droplet

In Digital Ocean dashboard:
1. Select your droplet
2. **Snapshots** tab
3. **Take Live Snapshot** (droplet stays online)
4. Use snapshot to create new droplet if needed

**Cost**: ~$0.06/GB/month for stored snapshots

---

## Next Steps

After successful deployment:

1. ✅ Test OAuth flow with your Google account
2. ✅ Process a test email to verify AI parsing
3. ✅ Set up calendar integration
4. ✅ Configure daily summary email schedule
5. ✅ Set up monitoring alerts
6. ✅ Create your first backup
7. ✅ Document your configuration for team members

---

## Support & Resources

- **Project Repository**: [Your repo link]
- **Digital Ocean Docs**: https://docs.digitalocean.com/
- **Docker Docs**: https://docs.docker.com/
- **Google Cloud Console**: https://console.cloud.google.com/

---

## Quick Reference Commands

```bash
# Deploy/Redeploy
./deploy.sh YOUR_IP

# View logs
ssh root@YOUR_IP 'cd /app/inbox-manager && docker compose logs -f'

# Restart app
ssh root@YOUR_IP 'cd /app/inbox-manager && docker compose restart'

# Check health
curl http://YOUR_IP:3000/health

# Manual backup
ssh root@YOUR_IP 'docker exec inbox-manager node dist/scripts/backupDb.js'

# Download database
scp root@YOUR_IP:/app/inbox-manager/data/app.db ./local-backup.db

# Check disk space
ssh root@YOUR_IP df -h

# Update system
ssh root@YOUR_IP 'apt update && apt upgrade -y'
```

---

**Last Updated**: 2026-01-13
**Tested On**: Digital Ocean Ubuntu 22.04, Docker 25.x, Docker Compose 2.x
