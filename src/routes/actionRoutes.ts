// src/routes/actionRoutes.ts

import type { FastifyInstance } from 'fastify';
import { validateAndUseToken } from '../db/emailActionTokenDb.js';
import { markTodoAsDone } from '../db/todoDb.js';
import { deleteEvent } from '../db/eventDb.js';

/**
 * Render a simple HTML result page for email action links
 */
function renderActionResult(success: boolean, title: string, subtitle?: string): string {
  const emoji = success ? '✅' : '❌';
  const bgColor = success ? '#d4edda' : '#f8d7da';

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
      max-width: 400px;
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
  </style>
</head>
<body>
  <div class="card">
    <div class="status">${emoji}</div>
    <div class="title">${title}</div>
    ${subtitle ? `<div class="subtitle">${subtitle}</div>` : ''}
  </div>
</body>
</html>
  `;
}

/**
 * Register action routes for token-based email actions
 * These routes do NOT require authentication - they use tokens instead
 */
export async function actionRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/action/:token
   * Execute an action based on a valid token
   * No authentication required - token is the auth
   */
  fastify.get<{ Params: { token: string } }>('/api/action/:token', async (request, reply) => {
    const { token } = request.params;

    fastify.log.info({ token: token.substring(0, 8) + '...' }, 'Action token request received');

    // Validate and use the token
    const result = validateAndUseToken(token);

    if (!result.valid) {
      fastify.log.warn({ token: token.substring(0, 8) + '...', error: result.error }, 'Action token validation failed');

      const errorMessage = result.error === 'Token has already been used'
        ? 'This action has already been completed.'
        : result.error === 'Token has expired'
          ? 'This link has expired. Please check your latest email.'
          : 'Invalid or expired link.';

      return reply.type('text/html').send(
        renderActionResult(false, 'Action Failed', errorMessage)
      );
    }

    // Execute the action based on type
    try {
      if (result.actionType === 'complete_todo') {
        const success = markTodoAsDone(result.userId!, result.targetId!);
        if (!success) {
          return reply.type('text/html').send(
            renderActionResult(false, 'Todo Not Found', 'The todo may have been deleted.')
          );
        }
        return reply.type('text/html').send(
          renderActionResult(true, 'Todo Completed!', 'You can close this window.')
        );
      }

      if (result.actionType === 'remove_event') {
        const success = deleteEvent(result.userId!, result.targetId!);
        if (!success) {
          return reply.type('text/html').send(
            renderActionResult(false, 'Event Not Found', 'The event may have been deleted.')
          );
        }
        return reply.type('text/html').send(
          renderActionResult(true, 'Event Removed!', 'You can close this window.')
        );
      }

      // Unknown action type
      return reply.type('text/html').send(
        renderActionResult(false, 'Unknown Action', 'This action type is not supported.')
      );
    } catch (error: any) {
      fastify.log.error({ err: error, token }, 'Error executing token action');
      return reply.type('text/html').send(
        renderActionResult(false, 'Action Failed', 'An error occurred. Please try again.')
      );
    }
  });
}
