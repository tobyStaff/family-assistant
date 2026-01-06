// src/routes/todoRoutes.ts
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  createTodo,
  listTodos,
  getTodo,
  updateTodo,
  deleteTodo,
  markTodoAsDone,
  markTodoAsPending,
} from '../db/todoDb.js';

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
 * Get user ID from request
 * TODO: Implement this with actual auth middleware from deliverables 1/2
 *
 * @param request - Fastify request
 * @returns User ID from JWT/session
 */
function getUserId(_request: FastifyRequest): string {
  // TODO: Extract from JWT token or session
  // For now, throw error to indicate auth not implemented
  throw new Error('Auth not implemented - placeholder for deliverable 1/2');
}

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
  fastify.get('/todos', async (request, reply) => {
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
  }>('/todos/:id', async (request, reply) => {
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
  }>('/todos', async (request, reply) => {
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
  }>('/todos/:id', async (request, reply) => {
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
  }>('/todos/:id', async (request, reply) => {
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
  }>('/todos/:id/done', async (request, reply) => {
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
  }>('/todos/:id/pending', async (request, reply) => {
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
}
