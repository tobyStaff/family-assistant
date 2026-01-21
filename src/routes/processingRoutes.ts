// src/routes/processingRoutes.ts

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getUserId, getUserAuth } from '../lib/userContext.js';
import { requireAuth } from '../middleware/session.js';
import { processEmails, type ProcessingOptions } from '../utils/emailProcessor.js';
import { getProcessingStats } from '../db/processedEmailsDb.js';
import { cleanupPastItems } from '../utils/cleanupPastItems.js';
import type { DateRange } from '../utils/inboxFetcher.js';

/**
 * Zod schema for processing request
 */
const ProcessEmailsSchema = z.object({
  dateRange: z.enum(['today', 'yesterday', 'last3days', 'last7days', 'last30days', 'last90days']),
  maxResults: z.number().min(1).max(500).optional(),
  aiProvider: z.enum(['openai', 'anthropic']).optional(),
  skipDuplicateEvents: z.boolean().optional(),
});

/**
 * Register email processing routes
 */
export async function processingRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /admin/process-emails
   * Trigger email processing pipeline
   */
  fastify.post<{
    Body: z.infer<typeof ProcessEmailsSchema>;
  }>('/admin/process-emails', { preHandler: requireAuth }, async (request, reply) => {
    const bodyResult = ProcessEmailsSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: 'Invalid request body',
        details: bodyResult.error.issues,
      });
    }

    try {
      const userId = getUserId(request);
      const auth = await getUserAuth(request);

      const options: ProcessingOptions = {
        dateRange: bodyResult.data.dateRange as DateRange,
        maxResults: bodyResult.data.maxResults,
        aiProvider: bodyResult.data.aiProvider,
        skipDuplicateEvents: bodyResult.data.skipDuplicateEvents ?? true,
      };

      fastify.log.info(
        { userId, options },
        'Starting email processing'
      );

      const result = await processEmails(userId, auth, options);

      fastify.log.info(
        {
          userId,
          success: result.success,
          events: result.events_created,
          todos: result.todos_created,
          time: result.processing_time_ms,
        },
        'Email processing completed'
      );

      return reply.code(200).send({
        success: result.success,
        stats: {
          emails_fetched: result.emails_fetched,
          emails_processed: result.emails_processed,
          emails_skipped: result.emails_skipped,
          events_created: result.events_created,
          todos_created: result.todos_created,
          processing_time_ms: result.processing_time_ms,
        },
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error processing emails');
      return reply.code(500).send({
        error: 'Failed to process emails',
        message: error.message,
      });
    }
  });

  /**
   * POST /admin/cleanup
   * Manually trigger cleanup of past todos and events
   */
  fastify.post('/admin/cleanup', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);

      const cleanup = cleanupPastItems(userId);

      fastify.log.info(
        {
          userId,
          todosCompleted: cleanup.todosCompleted,
          eventsRemoved: cleanup.eventsRemoved,
          cutoff: cleanup.cutoffDate.toISOString(),
        },
        'Manual cleanup completed'
      );

      return reply.code(200).send({
        success: true,
        cleanup: {
          todos_auto_completed: cleanup.todosCompleted,
          events_removed: cleanup.eventsRemoved,
          todo_ids: cleanup.todoIds,
          event_ids: cleanup.eventIds,
          cutoff_date: cleanup.cutoffDate.toISOString(),
        },
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error running cleanup');
      return reply.code(500).send({
        error: 'Failed to run cleanup',
        message: error.message,
      });
    }
  });

  /**
   * GET /admin/processing-status
   * Get processing status for user
   */
  fastify.get('/admin/processing-status', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const stats = getProcessingStats(userId);

      return reply.code(200).send({
        user_id: userId,
        total_emails_processed: stats.total_processed,
        last_processed_at: stats.last_processed_at?.toISOString() || null,
      });
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Error fetching processing status');
      return reply.code(500).send({
        error: 'Failed to fetch processing status',
        message: error.message,
      });
    }
  });

}
