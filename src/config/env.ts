import { z } from 'zod';
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Load environment variables from the appropriate .env file based on NODE_ENV.
 * Priority: .env.{NODE_ENV}.local > .env.{NODE_ENV} > .env.local > .env
 *
 * Since dotenv doesn't override by default, we load highest priority first.
 * The first value set for each variable wins.
 */
function loadEnvFile(): void {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const cwd = process.cwd();

  // List of env files in priority order (highest first)
  // Since dotenv doesn't override, first-loaded wins
  const envFiles = [
    `.env.${nodeEnv}.local`,  // .env.production.local or .env.development.local (highest priority, gitignored)
    `.env.${nodeEnv}`,         // .env.production or .env.development
    '.env.local',              // Local overrides (gitignored)
    '.env',                    // Default fallback (lowest priority)
  ];

  // Load in priority order - first loaded wins (dotenv doesn't override existing)
  for (const file of envFiles) {
    const filePath = join(cwd, file);
    if (existsSync(filePath)) {
      config({ path: filePath });
    }
  }
}

// Load env files before schema validation
loadEnvFile();

/**
 * Resolve environment-specific URL variables.
 * Allows single .env file with _LOCAL and _PROD suffixed variables.
 * Based on NODE_ENV, picks the appropriate value.
 *
 * Example: GOOGLE_REDIRECT_URI_LOCAL and GOOGLE_REDIRECT_URI_PROD
 *          -> Sets GOOGLE_REDIRECT_URI based on NODE_ENV
 *
 * Priority: Suffixed variable (_LOCAL/_PROD) ALWAYS wins over base variable
 */
function resolveEnvUrls(): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const suffix = isProduction ? '_PROD' : '_LOCAL';

  // List of URL variables that support _LOCAL/_PROD suffixes
  const urlVars = ['BASE_URL', 'GOOGLE_REDIRECT_URI'];

  for (const varName of urlVars) {
    const suffixedVar = `${varName}${suffix}`;
    // Suffixed version ALWAYS overrides base variable if present
    if (process.env[suffixedVar]) {
      process.env[varName] = process.env[suffixedVar];
    }
  }
}

// Resolve URL variables after loading env files
resolveEnvUrls();

// Log resolved URLs for debugging (only in development)
if (process.env.NODE_ENV !== 'production') {
  console.log('[env] NODE_ENV:', process.env.NODE_ENV || 'development');
  console.log('[env] BASE_URL resolved to:', process.env.BASE_URL || '(not set)');
  console.log('[env] GOOGLE_REDIRECT_URI resolved to:', process.env.GOOGLE_REDIRECT_URI || '(not set)');
}

/**
 * Environment variable schema using Zod.
 * Validates all required env vars at startup to fail fast.
 */
export const envSchema = z.object({
  // Server Configuration
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000').transform(Number),
  HOST: z.string().default('0.0.0.0'),

  // Encryption
  ENCRYPTION_SECRET: z.string().min(16, 'ENCRYPTION_SECRET must be at least 16 characters'),

  // Google OAuth Credentials
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),
  GOOGLE_REDIRECT_URI: z.string().url('GOOGLE_REDIRECT_URI must be a valid URL'),

  // Database
  DB_PATH: z.string().default('./data/inbox.db'),

  // AI Provider Configuration
  AI_PROVIDER: z.enum(['openai', 'anthropic']).default('openai'),
  AI_API_KEY: z.string().optional(), // Optional for development, required for AI parsing

  // AWS SES (Outbound Email)
  AWS_REGION: z.string().default('eu-north-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  SES_FROM_DOMAIN: z.string().default('inbox.getfamilyassistant.com'),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Fastify-compatible JSON Schema.
 * Manually maintained but structured to mirror Zod schema above.
 *
 * Note: Keep this in sync with envSchema when adding new env vars.
 * Future: When zod-to-json-schema supports Zod v4+, auto-generate this.
 */
export const fastifyEnvOptions = {
  schema: {
    type: 'object',
    required: ['ENCRYPTION_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'],
    properties: {
      NODE_ENV: {
        type: 'string',
        enum: ['development', 'production', 'test'],
        default: 'development',
      },
      PORT: {
        type: 'string',
        default: '3000',
      },
      HOST: {
        type: 'string',
        default: '0.0.0.0',
      },
      ENCRYPTION_SECRET: {
        type: 'string',
        minLength: 16,
      },
      GOOGLE_CLIENT_ID: {
        type: 'string',
        minLength: 1,
      },
      GOOGLE_CLIENT_SECRET: {
        type: 'string',
        minLength: 1,
      },
      GOOGLE_REDIRECT_URI: {
        type: 'string',
        minLength: 1,
      },
      DB_PATH: {
        type: 'string',
        default: './data/inbox.db',
      },
      AI_PROVIDER: {
        type: 'string',
        enum: ['openai', 'anthropic'],
        default: 'openai',
      },
      AI_API_KEY: {
        type: 'string',
      },
      AWS_REGION: {
        type: 'string',
        default: 'eu-north-1',
      },
      AWS_ACCESS_KEY_ID: {
        type: 'string',
      },
      AWS_SECRET_ACCESS_KEY: {
        type: 'string',
      },
      SES_FROM_DOMAIN: {
        type: 'string',
        default: 'inbox.getfamilyassistant.com',
      },
    },
  } as const,
  dotenv: false,  // We handle env file loading ourselves for multi-env support
  data: process.env,
};
