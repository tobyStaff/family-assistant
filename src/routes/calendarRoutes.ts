// src/routes/calendarRoutes.ts
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { google } from 'googleapis';
import { toZonedTime } from 'date-fns-tz';
import { formatISO } from 'date-fns';
import { checkForDuplicate } from '../utils/calendarDedup.js';
import type { EventData } from '../types/calendar.js';
import { getUserAuth } from '../lib/userContext.js';
import { requireAuth } from '../middleware/session.js';

/**
 * Zod schema for add event request validation
 */
const AddEventBodySchema = z.object({
  summary: z.string().min(1, 'Event summary is required'),
  description: z.string().optional(),
  start: z.coerce.date(), // Coerce string to Date
  end: z.coerce.date().optional(),
  parsedTimeZone: z.string().optional(),
});

/**
 * Get user's timezone preference
 * TODO: Implement this with database query from deliverable 7
 *
 * @returns User's IANA timezone (e.g., 'America/Los_Angeles')
 */
async function getUserTimeZone(_request: FastifyRequest): Promise<string> {
  // TODO: Replace with actual database query
  // This should:
  // 1. Get user ID from request
  // 2. Query user settings/profile table
  // 3. Return timezone or default to 'UTC'
  return 'UTC'; // Default for now
}

/**
 * Register calendar-related routes
 *
 * @param fastify - Fastify instance
 */
export async function calendarRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /add-event
   * Add a calendar event with timezone conversion and deduplication
   */
  fastify.post<{
    Body: z.infer<typeof AddEventBodySchema>;
  }>('/add-event', { preHandler: requireAuth }, async (request, reply) => {
    // Validate body
    const bodyResult = AddEventBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: 'Invalid event data',
        details: bodyResult.error.issues,
      });
    }

    try {
      // Get user's OAuth client and timezone
      const auth = await getUserAuth(request);
      const userTimeZone = await getUserTimeZone(request);

      // Convert parsed dates to user's timezone
      const zonedStart = toZonedTime(bodyResult.data.start, userTimeZone);
      const zonedEnd = bodyResult.data.end
        ? toZonedTime(bodyResult.data.end, userTimeZone)
        : undefined;

      // Construct event data for Calendar API
      const eventData: EventData = {
        summary: bodyResult.data.summary,
        start: {
          dateTime: formatISO(zonedStart),
          timeZone: userTimeZone,
        },
      };

      // Add optional fields
      if (bodyResult.data.description) {
        eventData.description = bodyResult.data.description;
      }

      if (zonedEnd) {
        eventData.end = {
          dateTime: formatISO(zonedEnd),
          timeZone: userTimeZone,
        };
      }

      // Check for duplicate event
      const isDuplicate = await checkForDuplicate(
        auth,
        'primary',
        eventData,
        userTimeZone
      );

      if (isDuplicate) {
        fastify.log.info(
          { summary: eventData.summary },
          'Event skipped (duplicate detected)'
        );
        return reply.code(200).send({
          success: true,
          skipped: true,
          message: 'Event skipped (duplicate)',
        });
      }

      // Insert event into Google Calendar
      const calendar = google.calendar({ version: 'v3', auth });
      const insertResponse = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: eventData,
      });

      fastify.log.info(
        { eventId: insertResponse.data.id, summary: eventData.summary },
        'Event added to calendar'
      );

      return reply.code(200).send({
        success: true,
        eventId: insertResponse.data.id,
        message: 'Event added to calendar',
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Error adding calendar event');
      return reply.code(500).send({
        error: 'Internal server error',
      });
    }
  });
}
