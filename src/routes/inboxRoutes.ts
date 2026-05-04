// src/routes/inboxRoutes.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listEmailsBySource, getEmailById } from '../db/emailDb.js';
import { getUser } from '../db/userDb.js';
import { getUserId } from '../lib/userContext.js';
import { requireAuth } from '../middleware/session.js';
import type { Role } from '../types/roles.js';
import { renderLayout } from '../templates/layout.js';
import {
  renderInboxListContent,
  renderInboxDetailContent,
} from '../templates/inboxContent.js';

const INBOX_LIMIT = 20;

const InboxIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export async function inboxRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/inbox', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = getUserId(request);
      const realUserId = (request as any).userId;
      const userRoles = ((request as any).userRoles as Role[]) || ['STANDARD'];
      const user = getUser(realUserId);

      const emails = listEmailsBySource(userId, 'hosted', INBOX_LIMIT, 0);

      const impersonatingUserId = (request as any).impersonatingUserId;
      const effectiveUser = impersonatingUserId ? getUser(impersonatingUserId) : null;

      const content = renderInboxListContent({ emails });

      const html = renderLayout({
        title: 'Inbox',
        currentPath: '/inbox',
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
      });

      return reply.type('text/html').send(html);
    } catch (error) {
      fastify.log.error({ err: error }, 'Error rendering inbox view');
      return reply.code(500).send('Error loading inbox');
    }
  });

  fastify.get<{
    Params: z.infer<typeof InboxIdParamsSchema>;
  }>('/inbox/:id', { preHandler: requireAuth }, async (request, reply) => {
    const paramsResult = InboxIdParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.code(400).send('Invalid email id');
    }

    try {
      const userId = getUserId(request);
      const realUserId = (request as any).userId;
      const userRoles = ((request as any).userRoles as Role[]) || ['STANDARD'];
      const user = getUser(realUserId);

      const email = getEmailById(userId, paramsResult.data.id);
      if (!email || email.source_type !== 'hosted') {
        return reply.code(404).type('text/html').send('Email not found');
      }

      const impersonatingUserId = (request as any).impersonatingUserId;
      const effectiveUser = impersonatingUserId ? getUser(impersonatingUserId) : null;

      const content = renderInboxDetailContent({ email });

      const html = renderLayout({
        title: email.subject || 'Email',
        currentPath: '/inbox',
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
      });

      return reply.type('text/html').send(html);
    } catch (error) {
      fastify.log.error({ err: error }, 'Error rendering inbox detail view');
      return reply.code(500).send('Error loading email');
    }
  });
}
