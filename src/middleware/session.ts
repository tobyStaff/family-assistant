// src/middleware/session.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { getSession } from '../db/sessionDb.js';
import { getUserRoles, getUser } from '../db/userDb.js';
import type { Role } from '../types/roles.js';

/**
 * Session middleware - extracts user ID and roles from session cookie
 * Runs on every request to attach user context
 *
 * Also handles impersonation for SUPER_ADMIN users
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

        // Fetch and attach user roles
        const roles = getUserRoles(session.user_id);
        (request as any).userRoles = roles;

        // Check for impersonation cookie (SUPER_ADMIN only)
        const impersonateCookie = (request as any).cookies?.impersonate_user_id;
        if (impersonateCookie && roles.includes('SUPER_ADMIN')) {
          const impersonateResult = (request as any).unsignCookie(impersonateCookie);
          if (impersonateResult.valid && impersonateResult.value) {
            const impersonatedUserId = impersonateResult.value;
            // Verify the impersonated user exists
            const impersonatedUser = getUser(impersonatedUserId);
            if (impersonatedUser) {
              (request as any).impersonatingUserId = impersonatedUserId;
            }
          }
        }
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
