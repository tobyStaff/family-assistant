// src/routes/todoRoutes.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createTodo,
  listTodos,
  getTodo,
  updateTodo,
  deleteTodo,
  markTodoAsDone,
  markTodoAsPending,
  getTodos,
  completeTodo,
} from '../db/todoDb.js';
import { getEmailByGmailId } from '../db/emailDb.js';
import { getUser } from '../db/userDb.js';
import { getTodoTypeEmoji, getTodoTypeLabel, TodoType } from '../types/extraction.js';
import { getUserId } from '../lib/userContext.js';
import { requireAuth } from '../middleware/session.js';
import { getPaymentButtonInfo } from '../utils/paymentProviders.js';
import type { Role } from '../types/roles.js';
import { renderLayout } from '../templates/layout.js';
import { renderTodosContent, renderTodosScripts } from '../templates/todosContent.js';

/**
 * Get the appropriate action button label based on todo type
 */
function getActionButtonLabel(type: TodoType): string {
  switch (type) {
    case 'PAY':
      return 'Pay Now →';
    case 'SIGN':
      return 'Sign Form →';
    case 'FILL':
      return 'Fill Form →';
    case 'READ':
      return 'Read Now →';
    case 'BUY':
      return 'Buy Now →';
    default:
      return 'Open Link →';
  }
}

/**
 * Render a simple HTML result page for email action links
 */
function renderActionResult(success: boolean, title: string, subtitle?: string): string {
  const emoji = success ? '✅' : '❌';
  const bgColor = success ? '#d4edda' : '#f8d7da';
  const borderColor = success ? '#28a745' : '#dc3545';

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
 * Zod schemas for request validation
 */
const CreateTodoBodySchema = z.object({
  description: z.string().min(1, 'Description is required'),
  due_date: z.string().datetime().optional(), // ISO 8601 format
  status: z.enum(['pending', 'done']).optional(),
});

const UpdateTodoBodySchema = z.object({
  description: z.string().min(1, 'Description is required'),
  due_date: z.string().datetime().optional(), // ISO 8601 format
  status: z.enum(['pending', 'done']).optional(),
});

const TodoIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/**
 * Register TODO-related routes
 *
 * @param fastify - Fastify instance
 */
export async function todoRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /todos
   * List all TODOs for the authenticated user
   */
  fastify.get('/todos', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const todos = listTodos(userId);

      return reply.code(200).send({
        todos,
        count: todos.length,
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Error listing todos');
      return reply.code(500).send({
        error: 'Internal server error',
      });
    }
  });

  /**
   * GET /todos/:id
   * Get a single TODO by ID
   */
  fastify.get<{
    Params: z.infer<typeof TodoIdParamsSchema>;
  }>('/todos/:id', { preHandler: requireAuth }, async (request, reply) => {
    // Validate params
    const paramsResult = TodoIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.code(400).send({
        error: 'Invalid params',
        details: paramsResult.error.issues,
      });
    }

    try {
      const userId = getUserId(request);
      const todo = getTodo(userId, paramsResult.data.id);

      if (!todo) {
        return reply.code(404).send({
          error: 'TODO not found',
        });
      }

      return reply.code(200).send({ todo });
    } catch (error) {
      fastify.log.error({ err: error }, 'Error getting todo');
      return reply.code(500).send({
        error: 'Internal server error',
      });
    }
  });

  /**
   * POST /todos
   * Create a new TODO
   */
  fastify.post<{
    Body: z.infer<typeof CreateTodoBodySchema>;
  }>('/todos', { preHandler: requireAuth }, async (request, reply) => {
    // Validate body
    const bodyResult = CreateTodoBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: 'Invalid body',
        details: bodyResult.error.issues,
      });
    }

    try {
      const userId = getUserId(request);
      const id = createTodo(
        userId,
        bodyResult.data.description,
        bodyResult.data.due_date ? new Date(bodyResult.data.due_date) : undefined,
        bodyResult.data.status
      );

      return reply.code(201).send({
        id,
        message: 'TODO created',
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Error creating todo');
      return reply.code(500).send({
        error: 'Internal server error',
      });
    }
  });

  /**
   * PUT /todos/:id
   * Update an existing TODO
   */
  fastify.put<{
    Params: z.infer<typeof TodoIdParamsSchema>;
    Body: z.infer<typeof UpdateTodoBodySchema>;
  }>('/todos/:id', { preHandler: requireAuth }, async (request, reply) => {
    // Validate params
    const paramsResult = TodoIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.code(400).send({
        error: 'Invalid params',
        details: paramsResult.error.issues,
      });
    }

    // Validate body
    const bodyResult = UpdateTodoBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({
        error: 'Invalid body',
        details: bodyResult.error.issues,
      });
    }

    try {
      const userId = getUserId(request);
      const success = updateTodo(
        userId,
        paramsResult.data.id,
        bodyResult.data.description,
        bodyResult.data.due_date ? new Date(bodyResult.data.due_date) : undefined,
        bodyResult.data.status
      );

      if (!success) {
        return reply.code(404).send({
          error: 'TODO not found',
        });
      }

      return reply.code(200).send({
        success: true,
        message: 'TODO updated',
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Error updating todo');
      return reply.code(500).send({
        error: 'Internal server error',
      });
    }
  });

  /**
   * DELETE /todos/:id
   * Delete a TODO
   */
  fastify.delete<{
    Params: z.infer<typeof TodoIdParamsSchema>;
  }>('/todos/:id', { preHandler: requireAuth }, async (request, reply) => {
    // Validate params
    const paramsResult = TodoIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.code(400).send({
        error: 'Invalid params',
        details: paramsResult.error.issues,
      });
    }

    try {
      const userId = getUserId(request);
      const success = deleteTodo(userId, paramsResult.data.id);

      if (!success) {
        return reply.code(404).send({
          error: 'TODO not found',
        });
      }

      return reply.code(200).send({
        success: true,
        message: 'TODO deleted',
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Error deleting todo');
      return reply.code(500).send({
        error: 'Internal server error',
      });
    }
  });

  /**
   * PATCH /todos/:id/done
   * Mark a TODO as done
   */
  fastify.patch<{
    Params: z.infer<typeof TodoIdParamsSchema>;
  }>('/todos/:id/done', { preHandler: requireAuth }, async (request, reply) => {
    // Validate params
    const paramsResult = TodoIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.code(400).send({
        error: 'Invalid params',
        details: paramsResult.error.issues,
      });
    }

    try {
      const userId = getUserId(request);
      const success = markTodoAsDone(userId, paramsResult.data.id);

      if (!success) {
        return reply.code(404).send({
          error: 'TODO not found',
        });
      }

      return reply.code(200).send({
        success: true,
        message: 'TODO marked as done',
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Error marking todo as done');
      return reply.code(500).send({
        error: 'Internal server error',
      });
    }
  });

  /**
   * PATCH /todos/:id/pending
   * Mark a TODO as pending
   */
  fastify.patch<{
    Params: z.infer<typeof TodoIdParamsSchema>;
  }>('/todos/:id/pending', { preHandler: requireAuth }, async (request, reply) => {
    // Validate params
    const paramsResult = TodoIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.code(400).send({
        error: 'Invalid params',
        details: paramsResult.error.issues,
      });
    }

    try {
      const userId = getUserId(request);
      const success = markTodoAsPending(userId, paramsResult.data.id);

      if (!success) {
        return reply.code(404).send({
          error: 'TODO not found',
        });
      }

      return reply.code(200).send({
        success: true,
        message: 'TODO marked as pending',
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Error marking todo as pending');
      return reply.code(500).send({
        error: 'Internal server error',
      });
    }
  });

  /**
   * GET /api/todos/:id/complete-from-email
   * Mark todo as done from email link (returns HTML confirmation page)
   */
  fastify.get<{ Params: { id: string } }>('/api/todos/:id/complete-from-email', { preHandler: requireAuth }, async (request, reply) => {
    const todoId = parseInt(request.params.id);

    if (isNaN(todoId)) {
      return reply.type('text/html').send(renderActionResult(false, 'Invalid todo ID'));
    }

    try {
      const userId = getUserId(request);
      const success = markTodoAsDone(userId, todoId);

      if (!success) {
        return reply.type('text/html').send(renderActionResult(false, 'Todo not found'));
      }

      return reply.type('text/html').send(renderActionResult(true, 'Todo marked as complete!', 'You can close this window.'));
    } catch (error) {
      fastify.log.error({ err: error, todoId }, 'Error completing todo from email');
      return reply.type('text/html').send(renderActionResult(false, 'Failed to complete todo'));
    }
  });

  /**
   * GET /todos-view
   * Render HTML view of todos with filters
   */
  fastify.get('/todos-view', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const realUserId = (request as any).userId;
      const userRoles = (request as any).userRoles as Role[] || ['STANDARD'];
      const user = getUser(realUserId);
      const todos = listTodos(userId);

      // Fetch source emails for todos that have them
      const sourceEmails = new Map<string, any>();
      for (const todo of todos) {
        if (todo.source_email_id && !sourceEmails.has(todo.source_email_id)) {
          const email = getEmailByGmailId(userId, todo.source_email_id);
          if (email) {
            sourceEmails.set(todo.source_email_id, email);
          }
        }
      }

      // Get unique children and types for filters
      const children = [...new Set(todos.map(t => t.child_name).filter(Boolean))] as string[];
      const types = ['PAY', 'BUY', 'PACK', 'SIGN', 'FILL', 'READ', 'REMIND'];

      // Check for impersonation
      const impersonatingUserId = (request as any).impersonatingUserId;
      const effectiveUser = impersonatingUserId ? getUser(impersonatingUserId) : null;

      // Generate content
      const content = renderTodosContent({
        todos: todos as any,
        sourceEmails,
        children,
        types,
      });

      const scripts = renderTodosScripts();

      // Render with layout
      const html = renderLayout({
        title: 'TODOs',
        currentPath: '/todos-view',
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
    } catch (error) {
      fastify.log.error({ err: error }, 'Error rendering todos view');
      return reply.code(500).send('Error loading todos');
    }
  });
}
