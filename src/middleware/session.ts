// src/middleware/session.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { getSession } from '../db/sessionDb.js';

/**
 * Session middleware - extracts user ID from session cookie
 * Runs on every request to attach user context
 *
 * @param request - Fastify request
 * @param reply - Fastify reply
 */
export async function sessionMiddleware(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const signedCookie = (request as any).cookies?.session_id;

  if (signedCookie) {
    // Unsign the cookie to get the actual session ID
    const unsignResult = (request as any).unsignCookie(signedCookie);

    if (unsignResult.valid && unsignResult.value) {
      const sessionId = unsignResult.value;
      const session = getSession(sessionId);

      if (session) {
        // Attach user_id to request for route handlers
        (request as any).userId = session.user_id;
      }
    }
  }
}

/**
 * Authentication guard middleware
 * Requires user to be authenticated (have valid session)
 * Returns 401 if not authenticated
 *
 * @param request - Fastify request
 * @param reply - Fastify reply
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const userId = (request as any).userId;

  if (!userId) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Please log in to access this resource',
    });
  }
}
