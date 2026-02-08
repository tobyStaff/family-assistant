// src/routes/eventRoutes.ts

import type { FastifyInstance } from 'fastify';
import { listEvents, getEvent, getEvents, deleteEvent, getEventStats } from '../db/eventDb.js';
import { getEmailByGmailId } from '../db/emailDb.js';
import { getUser, isCalendarConnected } from '../db/userDb.js';
import { syncEventsToCalendar } from '../utils/calendarIntegration.js';
import { getUserAuth } from '../db/authDb.js';
import { getUserId } from '../lib/userContext.js';
import { requireAuth } from '../middleware/session.js';
import type { Role } from '../types/roles.js';
import { renderLayout } from '../templates/layout.js';
import { renderEventsContent, renderEventsScripts } from '../templates/eventsContent.js';

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
      // Check if calendar is connected
      if (!isCalendarConnected(userId)) {
        return reply.code(400).send({ error: 'Google Calendar is not connected. Enable it in Settings.' });
      }

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
    const realUserId = (request as any).userId;
    const userRoles = (request as any).userRoles as Role[] || ['STANDARD'];
    const user = getUser(realUserId);

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

      // Get unique child names for filtering
      const children = [...new Set(events.map((e) => e.child_name).filter((c) => c))] as string[];

      // Check for impersonation
      const impersonatingUserId = (request as any).impersonatingUserId;
      const effectiveUser = impersonatingUserId ? getUser(impersonatingUserId) : null;

      // Generate content
      const content = renderEventsContent({
        events: events as any,
        stats,
        sourceEmails,
        children,
      });

      const scripts = renderEventsScripts();

      // Render with layout
      const html = renderLayout({
        title: 'Events',
        currentPath: '/events-view',
        user: {
          name: user?.name,
          email: user?.email || 'Unknown',
          picture_url: user?.picture_url,
        },
        userRoles,
        impersonating: effectiveUser ? {
          email: effectiveUser.email,
          name: effectiveUser.name,
        } : null,
        content,
        scripts,
      });

      return reply.type('text/html').send(html);
    } catch (error: any) {
      fastify.log.error({ err: error, userId }, 'Error rendering events view');
      return reply.code(500).send('Internal server error');
    }
  });
}
