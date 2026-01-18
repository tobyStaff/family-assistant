// src/routes/eventRoutes.ts

import type { FastifyInstance } from 'fastify';
import { listEvents, getEvent, getEvents, deleteEvent, getEventStats } from '../db/eventDb.js';
import { getEmailByGmailId } from '../db/emailDb.js';
import { syncEventsToCalendar } from '../utils/calendarIntegration.js';
import { getUserAuth } from '../db/authDb.js';
import { getUserId } from '../lib/userContext.js';
import { requireAuth } from '../middleware/session.js';

/**
 * Render a simple HTML result page for email action links
 */
function renderEventActionResult(success: boolean, title: string, subtitle?: string): string {
  const emoji = success ? '✅' : '❌';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .card {
      background: white;
      padding: 40px 60px;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      text-align: center;
    }
    .status {
      font-size: 64px;
      margin-bottom: 16px;
    }
    .title {
      font-size: 24px;
      color: #333;
      margin-bottom: 8px;
    }
    .subtitle {
      font-size: 14px;
      color: #666;
    }
    .back-link {
      margin-top: 20px;
      display: inline-block;
      color: #667eea;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="status">${emoji}</div>
    <div class="title">${title}</div>
    ${subtitle ? `<div class="subtitle">${subtitle}</div>` : ''}
    <a href="/dashboard" class="back-link">← Back to Dashboard</a>
  </div>
</body>
</html>
  `;
}

/**
 * Register event routes
 */
export async function eventRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /events
   * List all events for the authenticated user (JSON API)
   */
  fastify.get('/events', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const events = listEvents(userId);
      const stats = getEventStats(userId);

      return reply.code(200).send({
        events,
        stats,
        count: events.length,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error listing events');
      return reply.code(500).send({ error: 'Failed to fetch events' });
    }
  });

  /**
   * GET /events/:id
   * Get a single event by ID (JSON API)
   */
  fastify.get<{ Params: { id: string } }>('/events/:id', { preHandler: requireAuth }, async (request, reply) => {
    const userId = getUserId(request);
    const eventId = parseInt(request.params.id);

    if (isNaN(eventId)) {
      return reply.code(400).send({ error: 'Invalid event ID' });
    }

    try {
      const event = getEvent(userId, eventId);

      if (!event) {
        return reply.code(404).send({ error: 'Event not found' });
      }

      return reply.code(200).send({ event });
    } catch (error: any) {
      fastify.log.error({ err: error, userId, eventId }, 'Error fetching event');
      return reply.code(500).send({ error: 'Failed to fetch event' });
    }
  });

  /**
   * POST /events/:id/retry
   * Manually retry syncing a failed event
   */
  fastify.post<{ Params: { id: string } }>('/events/:id/retry', { preHandler: requireAuth }, async (request, reply) => {
    const userId = getUserId(request);
    const eventId = parseInt(request.params.id);

    if (isNaN(eventId)) {
      return reply.code(400).send({ error: 'Invalid event ID' });
    }

    try {
      // Get user's OAuth client
      const auth = await getUserAuth(userId);

      // Retry sync
      const syncResult = await syncEventsToCalendar(userId, auth, [eventId]);

      if (syncResult.synced > 0) {
        return reply.code(200).send({
          success: true,
          message: 'Event synced successfully',
        });
      } else {
        return reply.code(500).send({
          error: syncResult.errors[0]?.error || 'Sync failed',
        });
      }
    } catch (error: any) {
      fastify.log.error({ err: error, userId, eventId }, 'Error retrying event sync');
      return reply.code(500).send({ error: 'Failed to retry sync' });
    }
  });

  /**
   * DELETE /events/:id
   * Delete an event
   */
  fastify.delete<{ Params: { id: string } }>('/events/:id', { preHandler: requireAuth }, async (request, reply) => {
    const userId = getUserId(request);
    const eventId = parseInt(request.params.id);

    if (isNaN(eventId)) {
      return reply.code(400).send({ error: 'Invalid event ID' });
    }

    try {
      const deleted = deleteEvent(userId, eventId);

      if (!deleted) {
        return reply.code(404).send({ error: 'Event not found' });
      }

      return reply.code(200).send({
        success: true,
        message: 'Event deleted successfully',
      });
    } catch (error: any) {
      fastify.log.error({ err: error, userId, eventId }, 'Error deleting event');
      return reply.code(500).send({ error: 'Failed to delete event' });
    }
  });

  /**
   * GET /api/events/:id/remove-from-email
   * Remove event from email link (returns HTML confirmation page)
   */
  fastify.get<{ Params: { id: string } }>('/api/events/:id/remove-from-email', { preHandler: requireAuth }, async (request, reply) => {
    const eventId = parseInt(request.params.id);

    if (isNaN(eventId)) {
      return reply.type('text/html').send(renderEventActionResult(false, 'Invalid event ID'));
    }

    try {
      const userId = getUserId(request);
      const deleted = deleteEvent(userId, eventId);

      if (!deleted) {
        return reply.type('text/html').send(renderEventActionResult(false, 'Event not found'));
      }

      return reply.type('text/html').send(renderEventActionResult(true, 'Event removed!', 'You can close this window.'));
    } catch (error) {
      fastify.log.error({ err: error, eventId }, 'Error removing event from email');
      return reply.type('text/html').send(renderEventActionResult(false, 'Failed to remove event'));
    }
  });

  /**
   * GET /events-view
   * HTML view for managing events
   */
  fastify.get('/events-view', { preHandler: requireAuth }, async (request, reply) => {
    const userId = getUserId(request);

    try {
      const events = listEvents(userId);
      const stats = getEventStats(userId);

      // Fetch source emails for events that have them
      const sourceEmails = new Map<string, any>();
      for (const event of events) {
        if (event.source_email_id && !sourceEmails.has(event.source_email_id)) {
          const email = getEmailByGmailId(userId, event.source_email_id);
          if (email) {
            sourceEmails.set(event.source_email_id, email);
          }
        }
      }

      // Group events by sync status for filtering
      const pendingEvents = events.filter((e) => e.sync_status === 'pending');
      const syncedEvents = events.filter((e) => e.sync_status === 'synced');
      const failedEvents = events.filter((e) => e.sync_status === 'failed');

      // Get unique child names for filtering
      const children = [...new Set(events.map((e) => e.child_name).filter((c) => c))];

      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Events - Inbox Manager</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    .header {
      background: white;
      padding: 30px;
      border-radius: 12px;
      margin-bottom: 30px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    h1 {
      color: #333;
      margin-bottom: 10px;
    }

    .back-link {
      display: inline-block;
      color: #667eea;
      text-decoration: none;
      margin-bottom: 20px;
      font-weight: 500;
    }

    .back-link:hover {
      text-decoration: underline;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-top: 20px;
    }

    .stat-card {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
    }

    .stat-number {
      font-size: 32px;
      font-weight: bold;
      margin-bottom: 5px;
    }

    .stat-label {
      font-size: 14px;
      opacity: 0.9;
    }

    .filters {
      background: white;
      padding: 20px;
      border-radius: 12px;
      margin-bottom: 20px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .filter-group {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }

    .filter-label {
      font-weight: 600;
      color: #555;
    }

    .filter-btn {
      padding: 8px 16px;
      border: 2px solid #e0e0e0;
      background: white;
      border-radius: 20px;
      cursor: pointer;
      transition: all 0.2s;
      font-size: 14px;
    }

    .filter-btn:hover {
      border-color: #667eea;
      color: #667eea;
    }

    .filter-btn.active {
      background: #667eea;
      color: white;
      border-color: #667eea;
    }

    .event-card {
      background: white;
      padding: 20px;
      border-radius: 12px;
      margin-bottom: 15px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .event-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
    }

    .event-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 10px;
    }

    .event-title {
      font-size: 18px;
      font-weight: 600;
      color: #333;
      flex: 1;
    }

    .status-badge {
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      margin-left: 10px;
    }

    .status-synced {
      background: #e8f5e9;
      color: #2e7d32;
    }

    .status-pending {
      background: #fff3e0;
      color: #e65100;
    }

    .status-failed {
      background: #ffebee;
      color: #c62828;
    }

    .event-details {
      color: #666;
      font-size: 14px;
      margin: 8px 0;
    }

    .event-meta {
      display: flex;
      gap: 15px;
      flex-wrap: wrap;
      margin-top: 10px;
      font-size: 13px;
      color: #888;
    }

    .event-actions {
      margin-top: 15px;
      display: flex;
      gap: 10px;
    }

    .btn {
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s;
    }

    .btn-retry {
      background: #ff9800;
      color: white;
    }

    .btn-retry:hover {
      background: #f57c00;
    }

    .btn-delete {
      background: #f44336;
      color: white;
    }

    .btn-delete:hover {
      background: #d32f2f;
    }

    .empty-state {
      background: white;
      padding: 60px 20px;
      border-radius: 12px;
      text-align: center;
      color: #999;
    }

    .empty-state-icon {
      font-size: 64px;
      margin-bottom: 20px;
    }

    .source-email-toggle {
      background: #f8f9fa;
      border: 1px solid #e0e0e0;
      color: #666;
      font-size: 12px;
      padding: 4px 10px;
      border-radius: 4px;
      cursor: pointer;
    }

    .source-email-toggle:hover {
      background: #e9ecef;
    }

    .source-email-content {
      display: none;
      margin-top: 12px;
      padding: 12px;
      background: #f8f9fa;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      font-size: 13px;
    }

    .source-email-content.visible {
      display: block;
    }

    .source-email-header {
      font-weight: 600;
      color: #333;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid #e0e0e0;
    }

    .source-email-meta {
      color: #666;
      margin-bottom: 8px;
    }

    .source-email-body {
      white-space: pre-wrap;
      font-family: monospace;
      font-size: 12px;
      max-height: 300px;
      overflow-y: auto;
      background: white;
      padding: 8px;
      border-radius: 4px;
      border: 1px solid #e0e0e0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <a href="/dashboard" class="back-link">← Back to Dashboard</a>
      <h1>📅 Events</h1>

      <div class="stats">
        <div class="stat-card">
          <div class="stat-number">${stats.total}</div>
          <div class="stat-label">Total Events</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${stats.synced}</div>
          <div class="stat-label">Synced</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${stats.pending}</div>
          <div class="stat-label">Pending</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${stats.failed}</div>
          <div class="stat-label">Failed</div>
        </div>
      </div>
    </div>

    <div class="filters">
      <div class="filter-group">
        <span class="filter-label">Status:</span>
        <button class="filter-btn active" onclick="filterByStatus('all')">All (${stats.total})</button>
        <button class="filter-btn" onclick="filterByStatus('synced')">Synced (${stats.synced})</button>
        <button class="filter-btn" onclick="filterByStatus('pending')">Pending (${stats.pending})</button>
        <button class="filter-btn" onclick="filterByStatus('failed')">Failed (${stats.failed})</button>
      </div>

      ${
        children.length > 0
          ? `
      <div class="filter-group" style="margin-top: 10px;">
        <span class="filter-label">Child:</span>
        <button class="filter-btn active" onclick="filterByChild('all')">All</button>
        ${children.map((child) => `<button class="filter-btn" onclick="filterByChild('${child}')">${child}</button>`).join('')}
      </div>
      `
          : ''
      }
    </div>

    <div id="events-container">
      ${
        events.length === 0
          ? `
      <div class="empty-state">
        <div class="empty-state-icon">📅</div>
        <h2>No events yet</h2>
        <p>Events will appear here after processing emails</p>
      </div>
      `
          : events
              .map(
                (event) => `
      <div class="event-card" data-status="${event.sync_status}" data-child="${event.child_name || ''}">
        <div class="event-header">
          <div class="event-title">${event.title}</div>
          <span class="status-badge status-${event.sync_status}">
            ${
              event.sync_status === 'synced'
                ? '✓ Synced'
                : event.sync_status === 'pending'
                  ? '⏳ Pending'
                  : '❌ Failed'
            }
          </span>
        </div>

        <div class="event-details">
          📅 ${new Date(event.date).toLocaleString('en-GB', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
          ${event.end_date ? ` → ${new Date(event.end_date).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
        </div>

        ${event.description ? `<div class="event-details">${event.description}</div>` : ''}
        ${event.location ? `<div class="event-details">📍 ${event.location}</div>` : ''}

        <div class="event-meta">
          ${event.child_name ? `<span>👶 ${event.child_name}</span>` : ''}
          ${event.confidence ? `<span>🎯 ${Math.round(event.confidence * 100)}% confidence</span>` : ''}
          ${event.retry_count > 0 ? `<span>🔄 ${event.retry_count} ${event.retry_count === 1 ? 'retry' : 'retries'}</span>` : ''}
          ${event.google_calendar_event_id ? `<span>☁️ Calendar ID: ${event.google_calendar_event_id.substring(0, 12)}...</span>` : ''}
        </div>

        ${event.sync_error ? `<div class="event-details" style="color: #c62828; margin-top: 10px;">❌ Error: ${event.sync_error}</div>` : ''}

        <div class="event-actions">
          ${event.sync_status === 'failed' || event.sync_status === 'pending' ? `<button class="btn btn-retry" onclick="retrySync(${event.id})">🔄 Retry Sync</button>` : ''}
          <button class="btn btn-delete" onclick="deleteEvent(${event.id})">🗑️ Delete</button>
          ${event.source_email_id && sourceEmails.has(event.source_email_id) ? `
            <button class="source-email-toggle" onclick="toggleSourceEmail(${event.id})">📧 View Source Email</button>
          ` : ''}
        </div>
        ${(() => {
          if (!event.source_email_id) return '';
          const email = sourceEmails.get(event.source_email_id);
          if (!email) return '';
          const safeSubject = (email.subject || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const safeFrom = (email.from_email || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const safeBody = (email.body_text || email.snippet || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          return `
            <div class="source-email-content" id="source-email-${event.id}">
              <div class="source-email-header">📧 ${safeSubject}</div>
              <div class="source-email-meta">
                <strong>From:</strong> ${safeFrom}<br>
                <strong>Date:</strong> ${new Date(email.date).toLocaleString()}
              </div>
              <div class="source-email-body">${safeBody}</div>
            </div>
          `;
        })()}
      </div>
      `
              )
              .join('')
      }
    </div>
  </div>

  <script>
    function toggleSourceEmail(eventId) {
      const content = document.getElementById('source-email-' + eventId);
      if (content) {
        content.classList.toggle('visible');
        const btn = event.target;
        btn.textContent = content.classList.contains('visible') ? '📧 Hide Source Email' : '📧 View Source Email';
      }
    }

    let currentStatusFilter = 'all';
    let currentChildFilter = 'all';

    function filterByStatus(status) {
      currentStatusFilter = status;
      applyFilters();

      // Update button states
      document.querySelectorAll('.filter-btn').forEach(btn => {
        if (btn.textContent.toLowerCase().startsWith(status)) {
          btn.classList.add('active');
        } else if (status === 'all' && btn.textContent.startsWith('All')) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }

    function filterByChild(child) {
      currentChildFilter = child;
      applyFilters();
    }

    function applyFilters() {
      const cards = document.querySelectorAll('.event-card');

      cards.forEach(card => {
        const matchesStatus = currentStatusFilter === 'all' || card.dataset.status === currentStatusFilter;
        const matchesChild = currentChildFilter === 'all' || card.dataset.child === currentChildFilter;

        if (matchesStatus && matchesChild) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
    }

    async function retrySync(eventId) {
      if (!confirm('Retry syncing this event to Google Calendar?')) return;

      try {
        const response = await fetch(\`/events/\${eventId}/retry\`, {
          method: 'POST',
        });

        if (response.ok) {
          alert('Event sync retry initiated! The page will reload.');
          window.location.reload();
        } else {
          const error = await response.json();
          alert('Failed to retry sync: ' + (error.error || 'Unknown error'));
        }
      } catch (error) {
        alert('Failed to retry sync: ' + error.message);
      }
    }

    async function deleteEvent(eventId) {
      if (!confirm('Are you sure you want to delete this event? This cannot be undone.')) return;

      try {
        const response = await fetch(\`/events/\${eventId}\`, {
          method: 'DELETE',
        });

        if (response.ok) {
          alert('Event deleted successfully!');
          window.location.reload();
        } else {
          const error = await response.json();
          alert('Failed to delete event: ' + (error.error || 'Unknown error'));
        }
      } catch (error) {
        alert('Failed to delete event: ' + error.message);
      }
    }
  </script>
</body>
</html>
      `;

      return reply.type('text/html').send(html);
    } catch (error: any) {
      fastify.log.error({ err: error, userId }, 'Error rendering events view');
      return reply.code(500).send('Internal server error');
    }
  });
}
