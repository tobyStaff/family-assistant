// src/routes/commandProcessor.ts
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { routeParse } from '../parsers/parserRouter.js';
import { saveAttachmentToDrive } from '../utils/attachmentSaver.js';
import { getEmailContent, getAttachments } from '../utils/emailExtractor.js';
import { createTodo } from '../db/todoDb.js';
import { isProcessed, markProcessed } from '../db/processedDb.js';
import type { ParsedCommand, ParsedSemantics } from '../parsers/IParser.js';
import { toZonedTime } from 'date-fns-tz';
import { formatISO } from 'date-fns';
import { checkForDuplicate } from '../utils/calendarDedup.js';
import type { EventData } from '../types/calendar.js';
import { getUserId, getUserAuth } from '../lib/userContext.js';
import { requireAuth } from '../middleware/session.js';

/**
 * Zod schema for process command request validation
 */
const ProcessParamsSchema = z.object({
  emailId: z.string().min(1, 'Email ID is required'),
});

/**
 * Get user's timezone preference
 * TODO: Implement this with database query from deliverable 7
 *
 * @returns User's IANA timezone (e.g., 'America/Los_Angeles')
 */
async function getUserTimeZone(_request: FastifyRequest): Promise<string> {
  // TODO: Replace with actual database query
  return 'UTC'; // Default for now
}

/**
 * Add event to Google Calendar with deduplication
 */
async function addCalendarEvent(
  auth: OAuth2Client,
  eventData: {
    summary: string;
    description?: string;
    start: Date;
    end?: Date;
  },
  userTimeZone: string,
  fastify: FastifyInstance
): Promise<{ success: boolean; eventId?: string; skipped?: boolean }> {
  // Convert dates to user's timezone
  const zonedStart = toZonedTime(eventData.start, userTimeZone);
  const zonedEnd = eventData.end ? toZonedTime(eventData.end, userTimeZone) : undefined;

  // Construct event data for Calendar API
  const calendarEventData: EventData = {
    summary: eventData.summary,
    start: {
      dateTime: formatISO(zonedStart),
      timeZone: userTimeZone,
    },
  };

  if (eventData.description) {
    calendarEventData.description = eventData.description;
  }

  if (zonedEnd) {
    calendarEventData.end = {
      dateTime: formatISO(zonedEnd),
      timeZone: userTimeZone,
    };
  }

  // Check for duplicate event
  const isDuplicate = await checkForDuplicate(auth, 'primary', calendarEventData, userTimeZone);

  if (isDuplicate) {
    fastify.log.info({ summary: calendarEventData.summary }, 'Event skipped (duplicate detected)');
    return { success: true, skipped: true };
  }

  // Insert event into Google Calendar
  const calendar = google.calendar({ version: 'v3', auth });
  const insertResponse = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: calendarEventData,
  });

  fastify.log.info(
    { eventId: insertResponse.data.id, summary: calendarEventData.summary },
    'Event added to calendar'
  );

  const result: { success: boolean; eventId?: string; skipped?: boolean } = {
    success: true,
  };

  if (insertResponse.data.id) {
    result.eventId = insertResponse.data.id;
  }

  return result;
}

/**
 * Register command processor routes
 *
 * @param fastify - Fastify instance
 */
export async function commandProcessorRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /process-command/:emailId
   * Process a self-sent email command
   * - Checks idempotency
   * - Fetches email from Gmail
   * - Routes to appropriate parser (NLP or AI)
   * - Executes actions (save attachments, create TODOs, add calendar events)
   * - Marks email as processed
   */
  fastify.post<{
    Params: z.infer<typeof ProcessParamsSchema>;
  }>('/process-command/:emailId', { preHandler: requireAuth }, async (request, reply) => {
    // Validate params
    const paramsResult = ProcessParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.code(400).send({
        error: 'Invalid email ID',
        details: paramsResult.error.issues,
      });
    }

    const { emailId } = paramsResult.data;

    try {
      const userId = getUserId(request);
      const auth = await getUserAuth(request);
      const userTimeZone = await getUserTimeZone(request);

      // Idempotency check
      if (isProcessed(userId, emailId)) {
        fastify.log.info({ emailId }, 'Email already processed (idempotency)');
        return reply.code(200).send({
          success: true,
          message: 'Already processed',
        });
      }

      // Fetch email from Gmail
      const gmail = google.gmail({ version: 'v1', auth });
      const emailRes = await gmail.users.messages.get({
        userId: 'me',
        id: emailId,
        format: 'full', // Get body and attachments
      });

      const emailData = emailRes.data;

      // Extract content and attachments
      const content = getEmailContent(emailData);
      const attachments = getAttachments(emailData);

      fastify.log.info(
        { emailId, contentLength: content.length, attachmentCount: attachments.length },
        'Email fetched and parsed'
      );

      // Route to appropriate parser
      const parsed = await routeParse(content);

      if (!parsed) {
        fastify.log.warn({ emailId, content }, 'Parse failed - no result');
        return reply.code(400).send({
          error: 'Failed to parse email content',
        });
      }

      fastify.log.info({ emailId, parsed }, 'Email parsed successfully');

      // Execute actions
      const results: {
        savedFiles: string[];
        createdTodos: number[];
        createdEvents: string[];
      } = {
        savedFiles: [],
        createdTodos: [],
        createdEvents: [],
      };

      // Save attachments (always, per plan—defer analysis)
      for (const att of attachments) {
        const fileId = await saveAttachmentToDrive(auth, {
          emailId,
          attachmentId: att.id,
          fileName: att.filename,
        });
        if (fileId) {
          results.savedFiles.push(fileId);
        }
      }

      // Execute commands/actions based on parsed result
      if ('type' in parsed) {
        // ParsedCommand from NLP parser
        const cmd = parsed as ParsedCommand;

        if (cmd.type === 'todo' || cmd.type === 'task') {
          // Create TODO
          const todoId = createTodo(userId, cmd.description, cmd.dueDate);
          results.createdTodos.push(todoId);
          fastify.log.info({ todoId, description: cmd.description }, 'TODO created');
        } else if (cmd.type === 'cal') {
          // Add calendar event
          const eventResult = await addCalendarEvent(
            auth,
            {
              summary: cmd.description,
              start: cmd.dueDate || new Date(),
            },
            userTimeZone,
            fastify
          );

          if (eventResult.eventId) {
            results.createdEvents.push(eventResult.eventId);
          }
        }
      } else {
        // ParsedSemantics from AI parser
        const sem = parsed as ParsedSemantics;

        // Create TODOs for actions
        for (const act of sem.actions) {
          const todoId = createTodo(userId, act.description, act.dueDate);
          results.createdTodos.push(todoId);
          fastify.log.info({ todoId, description: act.description }, 'TODO created from AI parse');
        }

        // Add calendar events for dates
        for (const evt of sem.dates) {
          const eventParams: {
            summary: string;
            description?: string;
            start: Date;
            end?: Date;
          } = {
            summary: evt.event,
            start: evt.start,
          };

          if (evt.end) {
            eventParams.end = evt.end;
          }

          const eventResult = await addCalendarEvent(auth, eventParams, userTimeZone, fastify);

          if (eventResult.eventId) {
            results.createdEvents.push(eventResult.eventId);
          }
        }
      }

      // Mark email as processed
      markProcessed(userId, emailId);

      fastify.log.info({ emailId, results }, 'Email processed successfully');

      return reply.code(200).send({
        success: true,
        emailId,
        results,
        parsed,
      });
    } catch (error) {
      fastify.log.error({ err: error, emailId }, 'Error processing email command');
      return reply.code(500).send({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
