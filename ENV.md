# Environment Configuration

This project uses a multi-environment setup to handle different configurations for local development and production without manually editing files.

## Quick Start

```bash
# Local development (uses .env.local)
pnpm dev

# Production (uses .env.production)
pnpm start:prod
```

## Environment Files

### Loading Priority

The app loads environment files in this order (first found wins for each variable):

1. `.env.{NODE_ENV}.local` - Highest priority, for machine-specific overrides
2. `.env.{NODE_ENV}` - Environment-specific config (e.g., `.env.production`)
3. `.env.local` - Local development defaults
4. `.env` - Fallback defaults

### File Purposes

| File | Purpose | Git Status |
|------|---------|------------|
| `.env.local` | Local development config | Ignored |
| `.env.production` | Production config | Ignored |
| `.env.development` | Shared dev config (optional) | Ignored |
| `.env` | Fallback/defaults | Ignored |
| `.env.example` | Template for new setups | Tracked |

## Key Variables by Environment

### Local Development (`.env.local`)

```bash
NODE_ENV=development
LOG_LEVEL=debug
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
BASE_URL=http://localhost:3000
```

### Production (`.env.production`)

```bash
NODE_ENV=production
LOG_LEVEL=info
GOOGLE_REDIRECT_URI=https://getfamilyassistant.com/auth/google/callback
BASE_URL=https://getfamilyassistant.com
```

## NPM Scripts

| Script | NODE_ENV | Env File Used | Purpose |
|--------|----------|---------------|---------|
| `pnpm dev` | development | `.env.local` | Local development with hot reload |
| `pnpm start` | (from env) | Based on NODE_ENV | Start built app |
| `pnpm start:prod` | production | `.env.production` | Start in production mode |
| `pnpm build` | (default) | - | Build TypeScript |
| `pnpm build:prod` | production | - | Build for production |

## Required Variables

These must be set in your environment files:

```bash
# Security
ENCRYPTION_SECRET=<32-byte-hex-key>  # Generate: openssl rand -hex 32

# Google OAuth
GOOGLE_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<your-client-secret>
GOOGLE_REDIRECT_URI=<callback-url>  # Differs per environment!

# AI (at least one)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

## Setting Up a New Environment

1. Copy `.env.example` to your target file:
   ```bash
   cp .env.example .env.local      # For local dev
   cp .env.example .env.production # For production
   ```

2. Fill in your values, ensuring URLs match the environment:
   - Local: `http://localhost:3000`
   - Production: `https://your-domain.com`

3. Update Google Cloud Console with both redirect URIs:
   - `http://localhost:3000/auth/google/callback`
   - `https://your-domain.com/auth/google/callback`

## Deployment

For deployment to a server:

1. Copy `.env.production` to your server
2. Ensure `NODE_ENV=production` is set
3. Run with `pnpm start:prod` or `node dist/app.js`

The app will automatically load `.env.production` when `NODE_ENV=production`.

## Troubleshooting

### Wrong redirect URI error from Google

Check which env file is being loaded:
```bash
# In your app, NODE_ENV determines the file
echo $NODE_ENV  # Should be 'development' or 'production'
```

### Variables not loading

The loading happens in `src/config/env.ts`. Ensure:
1. The env file exists in the project root
2. NODE_ENV is set correctly
3. Variable names match exactly (case-sensitive)

### Check loaded values

Add temporary logging to see what's loaded:
```typescript
console.log('GOOGLE_REDIRECT_URI:', process.env.GOOGLE_REDIRECT_URI);
```
