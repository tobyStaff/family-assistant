// src/tracking/index.ts
//
// Public API for the tracking module. To enable tracking:
//   1. In app.ts, after the cookie + session plugins are registered:
//        await registerTracking(fastify);
//   2. In any HTML template that should be tracked, interpolate `${trackingScript}`
//      just before `</body>`.
//
// To remove tracking entirely:
//   - Delete the registerTracking() call in app.ts
//   - Remove `${trackingScript}` from any templates
//   - Delete this directory (src/tracking/)
//   - The tracking_events table in SQLite remains harmlessly until manually dropped

import type { FastifyInstance } from 'fastify';
import { ensureTrackingSchema } from './trackingDb.js';
import { trackingRoutes } from './trackingRoutes.js';
import { trackingAdminRoutes } from './trackingAdminRoutes.js';

export { trackingScript } from './trackingScript.js';
export { getRecentTrackingEvents } from './trackingDb.js';

/**
 * Wires up the tracking module:
 *   - Ensures the tracking_events schema exists
 *   - Registers POST /api/track (event ingest, rate-limited 60/min/IP)
 *   - Registers GET /admin/tracking (admin-only HTML dashboard)
 */
export async function registerTracking(fastify: FastifyInstance): Promise<void> {
  ensureTrackingSchema();
  await fastify.register(trackingRoutes);
  await fastify.register(trackingAdminRoutes);
}
