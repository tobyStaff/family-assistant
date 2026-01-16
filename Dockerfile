# Dockerfile for production deployment
FROM node:20-alpine

# Install build tools for native modules
RUN apk add --no-cache python3 make g++

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install production dependencies
RUN pnpm install --prod --frozen-lockfile

# Build native modules (version-agnostic path using wildcard)
RUN cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && \
    npx node-gyp rebuild --release

# Install devDependencies needed for build (typescript)
RUN pnpm add -D typescript

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript to JavaScript with increased memory limit
RUN NODE_OPTIONS="--max-old-space-size=1536" pnpm build

# Remove devDependencies after build to reduce image size
RUN pnpm prune --prod

# Create data directory for SQLite database
RUN mkdir -p /app/data

# Expose application port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production

# Run with memory limit for constrained environments
CMD ["node", "--max-old-space-size=512", "dist/app.js"]
