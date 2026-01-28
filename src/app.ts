// src/app.ts
import Fastify from 'fastify';
import fastifyEnv from '@fastify/env';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import { join } from 'path';
import { calendarRoutes } from './routes/calendarRoutes.js';
import { todoRoutes } from './routes/todoRoutes.js';
import { eventRoutes } from './routes/eventRoutes.js';
import { emailRoutes } from './routes/emailRoutes.js';
import { commandProcessorRoutes } from './routes/commandProcessor.js';
import { authRoutes } from './routes/authRoutes.js';
import { settingsRoutes } from './routes/settingsRoutes.js';
import { adminRoutes } from './routes/adminRoutes.js';
import { metricsRoutes } from './routes/metricsRoutes.js';
import { childProfileRoutes } from './routes/childProfileRoutes.js';
import { processingRoutes } from './routes/processingRoutes.js';
import { actionRoutes } from './routes/actionRoutes.js';
import { landingRoutes } from './routes/landingRoutes.js';
import { checkoutRoutes } from './routes/checkoutRoutes.js';
import { emailInboundRoutes } from './routes/emailInboundRoutes.js';
import dailySummaryPlugin from './plugins/dailySummary.js';
import metricsPlugin from './plugins/metrics.js';
import { sessionMiddleware } from './middleware/session.js';
import { requireAdmin } from './middleware/authorization.js';
import { fastifyEnvOptions } from './config/env.js';

/**
 * Build and configure Fastify application
 *
 * @returns Configured Fastify instance
 */
export async function buildApp() {
  const fastify = Fastify({
    logger:
      process.env.NODE_ENV === 'development'
        ? {
            level: process.env.LOG_LEVEL || 'info',
            transport: {
              target: 'pino-pretty',
              options: {
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
              },
            },
          }
        : {
            level: process.env.LOG_LEVEL || 'info',
          },
  });

  // Register environment variables plugin (loads .env file)
  await fastify.register(fastifyEnv, fastifyEnvOptions);

  // Register cookie plugin (required for sessions)
  if (!process.env.ENCRYPTION_SECRET) {
    throw new Error('ENCRYPTION_SECRET environment variable is required');
  }

  await fastify.register(cookie, {
    secret: process.env.ENCRYPTION_SECRET,
    parseOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    },
  });

  // Register formbody plugin (for parsing form submissions)
  await fastify.register(formbody);

  // Register static file serving for HTML pages
  await fastify.register(fastifyStatic, {
    root: join(process.cwd(), 'public'),
    prefix: '/public/',
  });

  // Register session middleware (global - runs on every request)
  fastify.addHook('onRequest', sessionMiddleware);

  // Health check endpoint (ADMIN only)
  fastify.get('/health', { preHandler: requireAdmin }, async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Register plugins
  await fastify.register(metricsPlugin);
  await fastify.register(dailySummaryPlugin);

  // Register routes (landing and checkout FIRST - public pages)
  await fastify.register(landingRoutes);
  await fastify.register(checkoutRoutes);
  await fastify.register(authRoutes);
  await fastify.register(actionRoutes);  // Token-based auth, no session required
  await fastify.register(settingsRoutes);
  await fastify.register(adminRoutes);
  await fastify.register(metricsRoutes);
  await fastify.register(childProfileRoutes);
  await fastify.register(processingRoutes);
  await fastify.register(calendarRoutes);
  await fastify.register(todoRoutes);
  await fastify.register(eventRoutes);
  await fastify.register(emailRoutes);
  await fastify.register(emailInboundRoutes);  // Hosted email webhook (no session required)
  await fastify.register(commandProcessorRoutes);

  return fastify;
}

/**
 * Start the application server
 */
async function start() {
  try {
    const fastify = await buildApp();

    const port = Number(process.env.PORT) || 3000;
    const host = process.env.HOST || '0.0.0.0';

    await fastify.listen({ port, host });

    fastify.log.info(`Server listening on ${host}:${port}`);
  } catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
}

// Start server if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
