// src/tracking/trackingAdminRoutes.ts
//
// GET /admin/tracking — server-rendered dashboard summarising the
// tracking_events table. Protected by requireAdmin so only ADMIN /
// SUPER_ADMIN users can view it. Wrapped in the shared app layout
// (sidebar nav, header, etc.) so it looks like the rest of the admin UI.
//
// Intentionally simple: no JavaScript, no charts, no auto-refresh. Just a
// few SQL aggregates rendered as HTML tables. The goal is "is the landing
// page converting?" answered at a glance; deeper drill-down can be done
// via sqlite3 directly using the queries documented in trackingDb.ts.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireAdmin } from '../middleware/authorization.js';
import { getUser } from '../db/userDb.js';
import { renderLayout } from '../templates/layout.js';
import type { Role } from '../types/roles.js';
import db from '../db/db.js';

interface CountRow {
  count: number;
}
interface EventTypeRow {
  event_type: string;
  count: number;
}
interface ClickTargetRow {
  href: string | null;
  text: string | null;
  count: number;
}
interface ScrollDepthRow {
  depth: number;
  visitors: number;
}
interface RecentEventRow {
  visitor_id: string;
  user_id: string | null;
  event_type: string;
  path: string;
  target: string | null;
  created_at: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render the tracking dashboard's inner content. The shared layout supplies
 * <html>/<head>/<body>, the sidebar nav, header, and base styles (.card,
 * .stat-card, .grid, .grid-3). Anything below that level — table styling,
 * funnel rows, etc. — is defined inline here, following the same pattern
 * metricsContent.ts uses.
 */
function renderTrackingContent(): string {
  // --- Last 24h summary ---
  const totalEvents24h = (
    db
      .prepare(
        `SELECT COUNT(*) as count FROM tracking_events
         WHERE created_at > datetime('now', '-1 day')`,
      )
      .get() as CountRow
  ).count;

  const uniqueVisitors24h = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT visitor_id) as count FROM tracking_events
         WHERE created_at > datetime('now', '-1 day')`,
      )
      .get() as CountRow
  ).count;

  const uniqueVisitors7d = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT visitor_id) as count FROM tracking_events
         WHERE created_at > datetime('now', '-7 days')`,
      )
      .get() as CountRow
  ).count;

  // --- Event counts by type (last 7 days) ---
  const eventsByType = db
    .prepare(
      `SELECT event_type, COUNT(*) as count FROM tracking_events
       WHERE created_at > datetime('now', '-7 days')
       GROUP BY event_type ORDER BY count DESC`,
    )
    .all() as EventTypeRow[];

  // --- Conversion funnel (last 7 days) ---
  // pageview → scroll past 50% → CTA click (anything pointing at /auth/google)
  const pageviewVisitors7d = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT visitor_id) as count FROM tracking_events
         WHERE event_type='pageview'
         AND created_at > datetime('now', '-7 days')`,
      )
      .get() as CountRow
  ).count;

  const scrolled50Visitors7d = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT visitor_id) as count FROM tracking_events
         WHERE event_type='scroll'
         AND created_at > datetime('now', '-7 days')
         AND CAST(json_extract(target, '$.depth') AS INTEGER) >= 50`,
      )
      .get() as CountRow
  ).count;

  const ctaClickVisitors7d = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT visitor_id) as count FROM tracking_events
         WHERE event_type='click'
         AND created_at > datetime('now', '-7 days')
         AND json_extract(target, '$.href') = '/auth/google'`,
      )
      .get() as CountRow
  ).count;

  // --- Scroll depth distribution (last 7 days) ---
  const scrollDepths = db
    .prepare(
      `SELECT CAST(json_extract(target, '$.depth') AS INTEGER) as depth,
              COUNT(DISTINCT visitor_id) as visitors
       FROM tracking_events
       WHERE event_type='scroll'
       AND created_at > datetime('now', '-7 days')
       GROUP BY depth ORDER BY depth`,
    )
    .all() as ScrollDepthRow[];

  // --- Top click targets (last 7 days) ---
  const topClicks = db
    .prepare(
      `SELECT json_extract(target, '$.href') as href,
              json_extract(target, '$.text') as text,
              COUNT(*) as count
       FROM tracking_events
       WHERE event_type='click'
       AND created_at > datetime('now', '-7 days')
       GROUP BY href, text
       ORDER BY count DESC
       LIMIT 20`,
    )
    .all() as ClickTargetRow[];

  // --- Recent events ---
  const recent = db
    .prepare(
      `SELECT visitor_id, user_id, event_type, path, target, created_at
       FROM tracking_events ORDER BY id DESC LIMIT 50`,
    )
    .all() as RecentEventRow[];

  const pct = (a: number, b: number): string =>
    b === 0 ? '0.0%' : `${((a / b) * 100).toFixed(1)}%`;

  return `
    <style>
      .tracking-table {
        background: var(--bg-card);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-md);
        padding: 24px;
        margin-bottom: 24px;
        overflow-x: auto;
      }
      .tracking-table h3 {
        font-family: var(--font-display);
        font-size: 18px;
        font-weight: 600;
        color: var(--primary-dark);
        margin: 0 0 16px;
      }
      .tracking-table table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }
      .tracking-table th {
        text-align: left;
        padding: 10px 12px;
        background: var(--bg-subtle, #f8fafc);
        color: var(--primary-color);
        font-weight: 600;
        opacity: 0.85;
        border-bottom: 1px solid var(--border-color, #e2e8f0);
      }
      .tracking-table td {
        padding: 10px 12px;
        border-bottom: 1px solid var(--border-color, #e2e8f0);
        vertical-align: top;
      }
      .tracking-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
      .tracking-table td code,
      .tracking-table td pre {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        color: var(--primary-dark);
      }
      .tracking-table td pre {
        margin: 0;
        max-width: 360px;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-all;
      }
      .funnel-row td { font-size: 15px; }
      .funnel-row .pct {
        color: var(--primary-color);
        opacity: 0.7;
        font-size: 13px;
        margin-left: 8px;
      }
      .tracking-empty {
        color: var(--primary-color);
        opacity: 0.6;
        font-style: italic;
        padding: 8px 0;
      }
    </style>

    <div class="card">
      <div class="card-header">
        <div class="card-title">Tracking</div>
      </div>
      <p style="opacity:0.75; margin:0 0 4px;">
        All data is from the landing page only. Updated on each page load.
      </p>
    </div>

    <div class="grid grid-3" style="margin-bottom: 24px;">
      <div class="stat-card">
        <div class="stat-label">Total events (24h)</div>
        <div class="stat-value">${totalEvents24h}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Unique visitors (24h)</div>
        <div class="stat-value">${uniqueVisitors24h}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Unique visitors (7d)</div>
        <div class="stat-value">${uniqueVisitors7d}</div>
      </div>
    </div>

    <div class="tracking-table">
      <h3>Conversion funnel (last 7 days)</h3>
      <table>
        <tbody>
          <tr class="funnel-row">
            <td>Landed on page</td>
            <td class="num">${pageviewVisitors7d}<span class="pct">100%</span></td>
          </tr>
          <tr class="funnel-row">
            <td>Scrolled past 50%</td>
            <td class="num">${scrolled50Visitors7d}<span class="pct">${pct(scrolled50Visitors7d, pageviewVisitors7d)}</span></td>
          </tr>
          <tr class="funnel-row">
            <td>Clicked sign-up CTA</td>
            <td class="num">${ctaClickVisitors7d}<span class="pct">${pct(ctaClickVisitors7d, pageviewVisitors7d)}</span></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="tracking-table">
      <h3>Events by type (last 7 days)</h3>
      ${
        eventsByType.length === 0
          ? `<p class="tracking-empty">No events yet.</p>`
          : `<table>
        <thead><tr><th>Event type</th><th style="text-align:right">Count</th></tr></thead>
        <tbody>
          ${eventsByType
            .map(
              (row) =>
                `<tr><td>${escapeHtml(row.event_type)}</td><td class="num">${row.count}</td></tr>`,
            )
            .join('')}
        </tbody>
      </table>`
      }
    </div>

    <div class="tracking-table">
      <h3>Scroll depth (unique visitors, last 7 days)</h3>
      ${
        scrollDepths.length === 0
          ? `<p class="tracking-empty">No scroll events yet.</p>`
          : `<table>
        <thead><tr><th>Depth</th><th style="text-align:right">Visitors</th></tr></thead>
        <tbody>
          ${scrollDepths
            .map(
              (row) =>
                `<tr><td>${row.depth}%</td><td class="num">${row.visitors}</td></tr>`,
            )
            .join('')}
        </tbody>
      </table>`
      }
    </div>

    <div class="tracking-table">
      <h3>Top click targets (last 7 days)</h3>
      ${
        topClicks.length === 0
          ? `<p class="tracking-empty">No click events yet.</p>`
          : `<table>
        <thead><tr><th>href</th><th>Text</th><th style="text-align:right">Clicks</th></tr></thead>
        <tbody>
          ${topClicks
            .map(
              (row) =>
                `<tr><td><code>${escapeHtml(row.href ?? '—')}</code></td><td>${escapeHtml(row.text ?? '')}</td><td class="num">${row.count}</td></tr>`,
            )
            .join('')}
        </tbody>
      </table>`
      }
    </div>

    <div class="tracking-table">
      <h3>Recent events (latest 50)</h3>
      ${
        recent.length === 0
          ? `<p class="tracking-empty">No events yet.</p>`
          : `<table>
        <thead><tr><th>When</th><th>Visitor</th><th>User</th><th>Event</th><th>Path</th><th>Target</th></tr></thead>
        <tbody>
          ${recent
            .map(
              (row) => `<tr>
              <td><code>${escapeHtml(row.created_at)}</code></td>
              <td><code>${escapeHtml(row.visitor_id.slice(0, 8))}</code></td>
              <td><code>${row.user_id ? escapeHtml(row.user_id.slice(0, 12)) : '—'}</code></td>
              <td>${escapeHtml(row.event_type)}</td>
              <td><code>${escapeHtml(row.path)}</code></td>
              <td>${row.target ? `<pre>${escapeHtml(row.target)}</pre>` : '—'}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>`
      }
    </div>
  `;
}

export async function trackingAdminRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/admin/tracking',
    { preHandler: requireAdmin },
    async (request: FastifyRequest, reply) => {
      // Pull user/role/impersonation context the same way metricsRoutes does
      const realUserId = (request as FastifyRequest & { userId?: string }).userId;
      const userRoles = ((request as FastifyRequest & { userRoles?: Role[] }).userRoles) ?? ['STANDARD'];
      const impersonatingUserId = (request as FastifyRequest & { impersonatingUserId?: string }).impersonatingUserId;

      const realUser = realUserId ? getUser(realUserId) : null;
      const impersonatedUser = impersonatingUserId ? getUser(impersonatingUserId) : null;

      const html = renderLayout({
        title: 'Tracking — Admin',
        currentPath: '/admin/tracking',
        user: {
          name: realUser?.name,
          email: realUser?.email ?? 'Unknown',
          picture_url: realUser?.picture_url,
        },
        userRoles,
        impersonating: impersonatedUser
          ? { email: impersonatedUser.email, name: impersonatedUser.name }
          : null,
        content: renderTrackingContent(),
      });

      return reply.type('text/html').send(html);
    },
  );
}
