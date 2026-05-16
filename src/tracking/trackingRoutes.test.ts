// src/tracking/trackingRoutes.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Mock the DB module so buildApp can load with all its schema-dependent imports
vi.mock('../db/db.js', async () => {
  const { createTestDb } = await import('../tests/createTestDb.js');
  return { default: createTestDb() };
});

// Bypass auth middleware so admin-protected routes elsewhere don't interfere
vi.mock('../middleware/authorization.js', () => ({
  requireAdmin: vi.fn((_req: any, _reply: any, done: () => void) => done()),
  requireSuperAdmin: vi.fn((_req: any, _reply: any, done: () => void) => done()),
  requireNoImpersonation: vi.fn((_req: any, _reply: any, done: () => void) => done()),
  isRequestUserSuperAdmin: vi.fn(() => false),
  getEffectiveUserId: vi.fn(() => null),
  isImpersonating: vi.fn(() => false),
}));

import { buildApp } from '../app.js';
import { register } from 'prom-client';
import { getRecentTrackingEvents } from './trackingDb.js';

describe('POST /api/track', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    register.clear();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('records a valid event and returns 204', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/track',
      headers: { 'content-type': 'application/json' },
      payload: { eventType: 'pageview', path: '/' },
    });

    expect(response.statusCode).toBe(204);

    const events = getRecentTrackingEvents(1);
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('pageview');
    expect(events[0]!.path).toBe('/');
  });

  it('sets the tracking_vid cookie on first request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/track',
      headers: { 'content-type': 'application/json' },
      payload: { eventType: 'pageview', path: '/' },
    });

    const setCookie = response.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : setCookie ?? '';
    expect(cookieStr).toMatch(/tracking_vid=/);
    expect(cookieStr.toLowerCase()).toContain('httponly');
  });

  it('reuses the visitor id on subsequent requests', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/track',
      headers: { 'content-type': 'application/json' },
      payload: { eventType: 'pageview', path: '/' },
    });
    const setCookie = first.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0]! : setCookie!;
    const vid = cookieHeader.match(/tracking_vid=([^;]+)/)![1];

    await app.inject({
      method: 'POST',
      url: '/api/track',
      headers: { 'content-type': 'application/json', cookie: `tracking_vid=${vid}` },
      payload: { eventType: 'scroll', path: '/', target: { depth: 50 } },
    });

    const events = getRecentTrackingEvents(2);
    expect(events).toHaveLength(2);
    expect(events[0]!.visitorId).toBe(events[1]!.visitorId);
    expect(events[0]!.visitorId).toBe(vid);
  });

  it('rejects payloads missing required fields', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/track',
      headers: { 'content-type': 'application/json' },
      payload: { eventType: 'pageview' }, // missing path
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects unknown event types', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/track',
      headers: { 'content-type': 'application/json' },
      payload: { eventType: 'arbitrary-event', path: '/' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('stores target as JSON string when provided', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/track',
      headers: { 'content-type': 'application/json' },
      payload: {
        eventType: 'click',
        path: '/',
        target: { tag: 'a', text: 'Sign up', href: '/auth/google' },
      },
    });

    const events = getRecentTrackingEvents(1);
    expect(events[0]!.target).toBe(
      JSON.stringify({ tag: 'a', text: 'Sign up', href: '/auth/google' }),
    );
  });
});
