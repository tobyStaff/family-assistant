import { z } from 'zod';

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
    },
  } as const,
  dotenv: true,
  data: process.env,
};
