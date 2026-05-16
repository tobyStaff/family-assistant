// src/tracking/trackingRoutes.ts
//
// POST /api/track — records one tracking event. No authentication required;
// authenticated requests (those carrying a valid session cookie) will have
// their userId captured automatically via the session middleware that already
// runs on every request.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import rateLimit from '@fastify/rate-limit';
import { insertTrackingEvent } from './trackingDb.js';

const VISITOR_COOKIE = 'tracking_vid';
const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year in seconds
const ALLOWED_EVENT_TYPES = new Set(['pageview', 'scroll', 'click']);

interface TrackEventPayload {
  eventType: string;
  path: string;
  target?: unknown;
  referrer?: string | null;
}

export async function trackingRoutes(fastify: FastifyInstance): Promise<void> {
  // Rate-limit only this route, not the whole app. A normal landing-page
  // visit fires ~1 pageview + up to 4 scroll thresholds + a handful of
  // clicks — well under 20 events. 60/min per IP is generous for real
  // visitors but blocks any obvious abuse (script spam, replay attacks).
  await fastify.register(rateLimit, { global: false });

  fastify.post(
    '/api/track',
    {
      bodyLimit: 4 * 1024, // 4 KB — events are small; reject obviously bogus payloads
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Visitor identification. Re-use the cookie if present; otherwise
      // generate one now and set it on the response. The first event from a
      // new visitor and any subsequent events all share this same id.
      const cookies = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies;
      let visitorId = cookies?.[VISITOR_COOKIE];
      if (!visitorId) {
        visitorId = randomUUID();
        reply.setCookie(VISITOR_COOKIE, visitorId, {
          maxAge: VISITOR_COOKIE_MAX_AGE,
          path: '/',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
        });
      }

      // Payload validation. Reject anything malformed but never throw —
      // tracking should not produce 5xx noise.
      const body = request.body as TrackEventPayload | undefined;
      if (
        !body ||
        typeof body.eventType !== 'string' ||
        typeof body.path !== 'string' ||
        !ALLOWED_EVENT_TYPES.has(body.eventType)
      ) {
        return reply.code(400).send({ error: 'invalid payload' });
      }

      // Truncate fields to prevent abuse / runaway storage
      const path = body.path.slice(0, 512);
      const target = body.target ? JSON.stringify(body.target).slice(0, 1024) : null;
      const referrer = typeof body.referrer === 'string' ? body.referrer.slice(0, 512) : null;
      const userAgent = (request.headers['user-agent'] || '').slice(0, 512) || null;

      // Pull userId from the session middleware if a logged-in user happens
      // to be browsing the landing page. Anonymous visitors leave it null.
      const userId = (request as FastifyRequest & { userId?: string | null }).userId ?? null;

      insertTrackingEvent({
        visitorId,
        userId,
        eventType: body.eventType,
        path,
        target,
        userAgent,
        referrer,
      });

      return reply.code(204).send();
    },
  );
}
