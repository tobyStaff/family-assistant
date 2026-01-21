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
import { getTodoTypeEmoji, getTodoTypeLabel, TodoType } from '../types/extraction.js';
import { getUserId } from '../lib/userContext.js';
import { requireAuth } from '../middleware/session.js';
import { getPaymentButtonInfo } from '../utils/paymentProviders.js';

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
      const children = [...new Set(todos.map(t => t.child_name).filter(Boolean))];
      const types = ['PAY', 'BUY', 'PACK', 'SIGN', 'FILL', 'READ', 'REMIND'];

      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Todos</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
    }
    h1 {
      color: #1a1a1a;
      margin-bottom: 8px;
    }
    .subtitle {
      color: #666;
      font-size: 14px;
    }
    .back-link {
      display: inline-block;
      color: #667eea;
      text-decoration: none;
      margin-bottom: 16px;
      font-size: 14px;
    }
    .back-link:hover {
      text-decoration: underline;
    }
    .filters {
      background: white;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
    }
    .filter-group {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
    }
    .filter-label {
      font-weight: 600;
      color: #333;
      margin-right: 8px;
    }
    .filter-btn {
      padding: 8px 16px;
      border: 2px solid #e0e0e0;
      background: white;
      border-radius: 20px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s;
    }
    .filter-btn:hover {
      border-color: #667eea;
      background: #f5f7ff;
    }
    .filter-btn.active {
      background: #667eea;
      color: white;
      border-color: #667eea;
    }
    .stats {
      display: flex;
      gap: 16px;
      margin-top: 16px;
    }
    .stat {
      padding: 8px 16px;
      background: #f8f9fa;
      border-radius: 8px;
      font-size: 13px;
      color: #666;
    }
    .stat strong {
      color: #333;
      font-weight: 600;
    }
    .todo-list {
      display: grid;
      gap: 16px;
    }
    .todo-card {
      background: white;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
      border-left: 4px solid #667eea;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .todo-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
    }
    .todo-card.done {
      opacity: 0.6;
      border-left-color: #4caf50;
    }
    .todo-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
    }
    .type-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 16px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .type-PAY { background: #ffebee; color: #c62828; }
    .type-BUY { background: #e3f2fd; color: #1565c0; }
    .type-PACK { background: #f3e5f5; color: #6a1b9a; }
    .type-SIGN { background: #fff3e0; color: #e65100; }
    .type-FILL { background: #e8f5e9; color: #2e7d32; }
    .type-READ { background: #fce4ec; color: #ad1457; }
    .type-REMIND { background: #f5f5f5; color: #616161; }
    .amount-badge {
      background: #dc3545;
      color: white;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 600;
      margin-left: 8px;
    }
    .auto-completed-badge {
      background: #6c757d;
      color: white;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
      margin-left: 8px;
    }
    .todo-description {
      font-size: 16px;
      color: #333;
      margin-bottom: 12px;
      line-height: 1.5;
    }
    .todo-meta {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      font-size: 13px;
      color: #666;
      margin-bottom: 12px;
    }
    .meta-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .todo-actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
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
    .btn-primary {
      background: #667eea;
      color: white;
    }
    .btn-primary:hover {
      background: #5568d3;
    }
    .btn-success {
      background: #4caf50;
      color: white;
    }
    .btn-success:hover {
      background: #43a047;
    }
    .btn-danger {
      background: #f44336;
      color: white;
    }
    .btn-danger:hover {
      background: #e53935;
    }
    .btn-secondary {
      background: #e0e0e0;
      color: #333;
    }
    .btn-secondary:hover {
      background: #d0d0d0;
    }
    .empty-state {
      background: white;
      border-radius: 12px;
      padding: 60px 20px;
      text-align: center;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
    }
    .empty-state-icon {
      font-size: 64px;
      margin-bottom: 16px;
    }
    .empty-state-text {
      color: #666;
      font-size: 18px;
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
      <h1>📝 My Todos</h1>
      <p class="subtitle">Manage your action items</p>
    </div>

    <div class="filters">
      <div class="filter-group">
        <span class="filter-label">Filter by Type:</span>
        <button class="filter-btn active" onclick="filterByType('all')">All</button>
        ${types.map(type => `
          <button class="filter-btn" onclick="filterByType('${type}')">${getTodoTypeEmoji(type as any)} ${type}</button>
        `).join('')}
      </div>

      ${children.length > 0 ? `
        <div class="filter-group" style="margin-top: 12px;">
          <span class="filter-label">Filter by Child:</span>
          <button class="filter-btn active" onclick="filterByChild('all')">All</button>
          ${children.map(child => `
            <button class="filter-btn" onclick="filterByChild('${child}')">👶 ${child}</button>
          `).join('')}
        </div>
      ` : ''}

      <div class="filter-group" style="margin-top: 12px;">
        <span class="filter-label">Status:</span>
        <button class="filter-btn active" onclick="filterByStatus('all')">All</button>
        <button class="filter-btn" onclick="filterByStatus('pending')">⏳ Pending</button>
        <button class="filter-btn" onclick="filterByStatus('done')">✅ Done</button>
      </div>

      <div class="stats">
        <div class="stat">Total: <strong id="stat-total">${todos.length}</strong></div>
        <div class="stat">Pending: <strong id="stat-pending">${todos.filter(t => t.status === 'pending').length}</strong></div>
        <div class="stat">Done: <strong id="stat-done">${todos.filter(t => t.status === 'done').length}</strong></div>
      </div>
    </div>

    <div class="todo-list" id="todo-list">
      ${todos.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state-icon">✨</div>
          <div class="empty-state-text">No todos yet! Run the email processor to extract action items.</div>
        </div>
      ` : todos.map(todo => `
        <div class="todo-card ${todo.status === 'done' ? 'done' : ''}"
             data-type="${todo.type}"
             data-child="${todo.child_name || ''}"
             data-status="${todo.status}">
          <div class="todo-header">
            <div>
              <span class="type-badge type-${todo.type}">
                ${getTodoTypeEmoji(todo.type)} ${getTodoTypeLabel(todo.type)}
              </span>
              ${todo.amount ? `<span class="amount-badge">${todo.amount}</span>` : ''}
            </div>
          </div>
          <div class="todo-description">${todo.description}</div>
          <div class="todo-meta">
            ${(() => {
              // Defensive date rendering - check if date is valid
              let parts = [];
              if (todo.due_date) {
                const date = new Date(todo.due_date);
                if (!isNaN(date.getTime())) {
                  parts.push(`<div class="meta-item">⏰ Due: ${date.toLocaleDateString()}</div>`);
                }
              }
              // Show recurrence pattern for recurring items
              if (todo.recurring && todo.recurrence_pattern) {
                parts.push(`<div class="meta-item">🔄 ${todo.recurrence_pattern}</div>`);
              }
              return parts.join('');
            })()}
            ${todo.child_name ? `<div class="meta-item">👶 ${todo.child_name}</div>` : ''}
            ${todo.confidence ? `<div class="meta-item">🎯 ${Math.round(todo.confidence * 100)}% confidence</div>` : ''}
            ${todo.completed_at ? `<div class="meta-item">✅ Completed: ${new Date(todo.completed_at).toLocaleDateString()}${todo.auto_completed ? ' <span class="auto-completed-badge">Auto</span>' : ''}</div>` : ''}
          </div>
          <div class="todo-actions">
            ${todo.status === 'pending' ? `
              <button class="btn btn-success" onclick="markAsDone(${todo.id})">✓ Mark Done</button>
            ` : `
              <button class="btn btn-secondary" onclick="markAsPending(${todo.id})">↩ Mark Pending</button>
            `}
            ${(() => {
              const paymentBtn = getPaymentButtonInfo(todo);
              if (paymentBtn) {
                return `<a href="${paymentBtn.url}" target="_blank" class="btn btn-primary">${paymentBtn.label}</a>`;
              }
              return '';
            })()}
            <button class="btn btn-danger" onclick="deleteTodo(${todo.id})">🗑️ Delete</button>
            ${todo.source_email_id && sourceEmails.has(todo.source_email_id) ? `
              <button class="source-email-toggle" onclick="toggleSourceEmail(${todo.id})">📧 View Source Email</button>
            ` : ''}
          </div>
          ${(() => {
            if (!todo.source_email_id) return '';
            const email = sourceEmails.get(todo.source_email_id);
            if (!email) return '';
            const safeSubject = (email.subject || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const safeFrom = (email.from_email || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const safeBody = (email.body_text || email.snippet || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `
              <div class="source-email-content" id="source-email-${todo.id}">
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
      `).join('')}
    </div>
  </div>

  <script>
    function toggleSourceEmail(todoId) {
      const content = document.getElementById('source-email-' + todoId);
      if (content) {
        content.classList.toggle('visible');
        const btn = event.target;
        btn.textContent = content.classList.contains('visible') ? '📧 Hide Source Email' : '📧 View Source Email';
      }
    }

    let currentTypeFilter = 'all';
    let currentChildFilter = 'all';
    let currentStatusFilter = 'all';

    function filterByType(type) {
      currentTypeFilter = type;
      updateFilters();
      applyFilters();
    }

    function filterByChild(child) {
      currentChildFilter = child;
      updateFilters();
      applyFilters();
    }

    function filterByStatus(status) {
      currentStatusFilter = status;
      updateFilters();
      applyFilters();
    }

    function updateFilters() {
      // Update button states
      document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
      });
      document.querySelectorAll('.filter-btn').forEach(btn => {
        const text = btn.textContent.trim();
        if ((currentTypeFilter === 'all' && text === 'All') ||
            (currentTypeFilter !== 'all' && text.includes(currentTypeFilter)) ||
            (currentChildFilter !== 'all' && text.includes(currentChildFilter)) ||
            (currentStatusFilter !== 'all' && text.includes(currentStatusFilter === 'pending' ? 'Pending' : 'Done')) ||
            (currentStatusFilter === 'all' && text === 'All')) {
          btn.classList.add('active');
        }
      });
    }

    function applyFilters() {
      const cards = document.querySelectorAll('.todo-card');
      let visibleCount = 0;
      let pendingCount = 0;
      let doneCount = 0;

      cards.forEach(card => {
        const type = card.dataset.type;
        const child = card.dataset.child;
        const status = card.dataset.status;

        const typeMatch = currentTypeFilter === 'all' || type === currentTypeFilter;
        const childMatch = currentChildFilter === 'all' || child === currentChildFilter;
        const statusMatch = currentStatusFilter === 'all' || status === currentStatusFilter;

        if (typeMatch && childMatch && statusMatch) {
          card.style.display = 'block';
          visibleCount++;
          if (status === 'pending') pendingCount++;
          if (status === 'done') doneCount++;
        } else {
          card.style.display = 'none';
        }
      });

      // Update stats
      document.getElementById('stat-total').textContent = visibleCount;
      document.getElementById('stat-pending').textContent = pendingCount;
      document.getElementById('stat-done').textContent = doneCount;
    }

    async function markAsDone(id) {
      try {
        const response = await fetch(\`/todos/\${id}/done\`, {
          method: 'PATCH'
        });
        if (response.ok) {
          location.reload();
        } else {
          alert('Failed to mark todo as done');
        }
      } catch (error) {
        alert('Error: ' + error.message);
      }
    }

    async function markAsPending(id) {
      try {
        const response = await fetch(\`/todos/\${id}/pending\`, {
          method: 'PATCH'
        });
        if (response.ok) {
          location.reload();
        } else {
          alert('Failed to mark todo as pending');
        }
      } catch (error) {
        alert('Error: ' + error.message);
      }
    }

    async function deleteTodo(id) {
      if (!confirm('Are you sure you want to delete this todo?')) return;

      try {
        const response = await fetch(\`/todos/\${id}\`, {
          method: 'DELETE'
        });
        if (response.ok) {
          location.reload();
        } else {
          alert('Failed to delete todo');
        }
      } catch (error) {
        alert('Error: ' + error.message);
      }
    }
  </script>
</body>
</html>
      `;

      return reply.type('text/html').send(html);
    } catch (error) {
      fastify.log.error({ err: error }, 'Error rendering todos view');
      return reply.code(500).send('Error loading todos');
    }
  });
}
