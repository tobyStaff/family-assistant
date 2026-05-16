// src/tracking/trackingAdminRoutes.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../db/db.js', async () => {
  const { createTestDb } = await import('../tests/createTestDb.js');
  return { default: createTestDb() };
});

// Pass-through requireAdmin so we can hit /admin/tracking without a real session
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
import { insertTrackingEvent } from './trackingDb.js';

describe('GET /admin/tracking', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    register.clear();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('renders HTML with empty-state messages when no events exist', async () => {
    const response = await app.inject({ method: 'GET', url: '/admin/tracking' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('Tracking');
    expect(response.body).toContain('Conversion funnel');
    expect(response.body).toContain('No events yet.');
  });

  it('wraps the page in the shared app layout (sidebar nav + shared styles)', async () => {
    const response = await app.inject({ method: 'GET', url: '/admin/tracking' });
    // Sidebar nav items defined in layout.ts should be present
    expect(response.body).toContain('Dashboard');
    expect(response.body).toContain('Settings');
    // Shared layout uses these CSS variables for tokens
    expect(response.body).toContain('--bg-card');
    // Shared utility classes from layout.ts
    expect(response.body).toContain('stat-card');
  });

  it('renders aggregate stats when events have been recorded', async () => {
    insertTrackingEvent({
      visitorId: 'v1',
      userId: null,
      eventType: 'pageview',
      path: '/',
      target: null,
      userAgent: null,
      referrer: null,
    });
    insertTrackingEvent({
      visitorId: 'v1',
      userId: null,
      eventType: 'scroll',
      path: '/',
      target: JSON.stringify({ depth: 50 }),
      userAgent: null,
      referrer: null,
    });
    insertTrackingEvent({
      visitorId: 'v1',
      userId: null,
      eventType: 'click',
      path: '/',
      target: JSON.stringify({ tag: 'a', text: 'Sign-up', href: '/auth/google' }),
      userAgent: null,
      referrer: null,
    });

    const response = await app.inject({ method: 'GET', url: '/admin/tracking' });
    expect(response.statusCode).toBe(200);
    // The funnel should now show 1 visitor at each stage
    expect(response.body).toMatch(/Landed on page[\s\S]*?>1</);
    expect(response.body).toMatch(/Clicked sign-up CTA[\s\S]*?>1</);
    // Event-type table should include all three rows
    expect(response.body).toContain('pageview');
    expect(response.body).toContain('scroll');
    expect(response.body).toContain('click');
  });

  it('escapes HTML in event data to prevent injection', async () => {
    insertTrackingEvent({
      visitorId: 'v1',
      userId: null,
      eventType: 'click',
      path: '/',
      target: JSON.stringify({ tag: 'a', text: '<script>alert(1)</script>', href: '/' }),
      userAgent: null,
      referrer: null,
    });

    const response = await app.inject({ method: 'GET', url: '/admin/tracking' });
    expect(response.body).not.toContain('<script>alert(1)</script>');
    expect(response.body).toContain('&lt;script&gt;');
  });
});
