// src/routes/detailRoutes.ts

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { validateTokenReadOnly } from '../db/emailActionTokenDb.js';
import { getTodo, getTodosBySourceEmailId, markTodoAsDone } from '../db/todoDb.js';
import { getEvent, getEventsBySourceEmailId, deleteEvent } from '../db/eventDb.js';
import { getEmailById, getEmailByGmailId } from '../db/emailDb.js';
import { getAttachmentsByEmailId, getAttachmentById } from '../db/attachmentDb.js';
import { getAnalysisByEmailId } from '../db/emailAnalysisDb.js';
import {
  renderTodoDetail,
  renderEventDetail,
  renderNotFound,
  renderExpired,
} from '../templates/itemDetailTemplate.js';
import { renderSourceEmail } from '../templates/sourceEmailTemplate.js';
import { createReadStream, existsSync, statSync } from 'fs';
import { join, resolve, sep } from 'path';

const ATTACHMENTS_ROOT = resolve(process.cwd(), 'data', 'attachments');

function getSessionUserId(request: FastifyRequest): string | null {
  return (request as any).userId ?? null;
}

function viewBase(token: string): string {
  return `/view/${token}`;
}

/**
 * Register progressive-detail routes for summary items.
 * Read-only L2/L3 views use the per-summary view token (forwardable).
 * Mutating POSTs additionally require a logged-in session for the owning user.
 */
export async function detailRoutes(fastify: FastifyInstance): Promise<void> {
  // -------- L2: Todo detail ----------
  fastify.get<{ Params: { token: string; id: string } }>(
    '/view/:token/todo/:id',
    async (request, reply) => {
      const { token, id } = request.params;
      const todoId = Number.parseInt(id, 10);
      if (!Number.isFinite(todoId)) return reply.code(400).type('text/html').send(renderNotFound('Invalid id'));

      const result = validateTokenReadOnly(token);
      if (!result.valid) return reply.code(410).type('text/html').send(renderExpired());

      const todo = getTodo(result.userId!, todoId);
      if (!todo) return reply.code(404).type('text/html').send(renderNotFound('Todo not found'));

      const sourceEmail = todo.source_email_id
        ? getEmailByGmailId(result.userId!, todo.source_email_id)
        : null;
      const analysis = sourceEmail
        ? getAnalysisByEmailId(result.userId!, sourceEmail.id)
        : null;

      const relatedTodos = todo.source_email_id
        ? getTodosBySourceEmailId(result.userId!, todo.source_email_id)
        : [];
      const relatedEvents = todo.source_email_id
        ? getEventsBySourceEmailId(result.userId!, todo.source_email_id)
        : [];

      const html = renderTodoDetail({
        todo,
        sourceEmail,
        analysisSummary: analysis?.email_summary ?? null,
        relatedTodos,
        relatedEvents,
        viewBase: viewBase(token),
        hasSession: getSessionUserId(request) === result.userId,
      });
      return reply.type('text/html').send(html);
    }
  );

  // -------- L2: Event detail ----------
  fastify.get<{ Params: { token: string; id: string } }>(
    '/view/:token/event/:id',
    async (request, reply) => {
      const { token, id } = request.params;
      const eventId = Number.parseInt(id, 10);
      if (!Number.isFinite(eventId)) return reply.code(400).type('text/html').send(renderNotFound('Invalid id'));

      const result = validateTokenReadOnly(token);
      if (!result.valid) return reply.code(410).type('text/html').send(renderExpired());

      const event = getEvent(result.userId!, eventId);
      if (!event) return reply.code(404).type('text/html').send(renderNotFound('Event not found'));

      const sourceEmail = event.source_email_id
        ? getEmailByGmailId(result.userId!, event.source_email_id)
        : null;
      const analysis = sourceEmail
        ? getAnalysisByEmailId(result.userId!, sourceEmail.id)
        : null;

      const relatedTodos = event.source_email_id
        ? getTodosBySourceEmailId(result.userId!, event.source_email_id)
        : [];
      const relatedEvents = event.source_email_id
        ? getEventsBySourceEmailId(result.userId!, event.source_email_id)
        : [];

      const html = renderEventDetail({
        event,
        sourceEmail,
        analysisSummary: analysis?.email_summary ?? null,
        relatedTodos,
        relatedEvents,
        viewBase: viewBase(token),
        hasSession: getSessionUserId(request) === result.userId,
      });
      return reply.type('text/html').send(html);
    }
  );

  // -------- L3: Source email view ----------
  fastify.get<{ Params: { token: string; emailId: string }; Querystring: { from?: string } }>(
    '/view/:token/email/:emailId',
    async (request, reply) => {
      const { token, emailId } = request.params;
      const id = Number.parseInt(emailId, 10);
      if (!Number.isFinite(id)) return reply.code(400).type('text/html').send(renderNotFound('Invalid id'));

      const result = validateTokenReadOnly(token);
      if (!result.valid) return reply.code(410).type('text/html').send(renderExpired());

      const email = getEmailById(result.userId!, id);
      if (!email) return reply.code(404).type('text/html').send(renderNotFound('Email not found'));

      const attachments = getAttachmentsByEmailId(email.id);

      // Build a "back to item" breadcrumb if the caller passed ?from=todo:123
      let backHref: string | undefined;
      const from = (request.query as any)?.from as string | undefined;
      if (from && /^(todo|event):\d+$/.test(from)) {
        const [kind, itemId] = from.split(':');
        backHref = `${viewBase(token)}/${kind}/${itemId}`;
      }

      const html = renderSourceEmail({
        email,
        attachments,
        viewBase: viewBase(token),
        backHref,
      });
      return reply.type('text/html').send(html);
    }
  );

  // -------- Attachment file serving ----------
  fastify.get<{ Params: { token: string; id: string } }>(
    '/view/:token/attachment/:id',
    async (request, reply) => {
      const { token, id } = request.params;
      const attId = Number.parseInt(id, 10);
      if (!Number.isFinite(attId)) return reply.code(400).send('Invalid id');

      const result = validateTokenReadOnly(token);
      if (!result.valid) return reply.code(410).send('Link expired');

      const attachment = getAttachmentById(attId);
      if (!attachment) return reply.code(404).send('Attachment not found');

      // Ownership: verify the parent email belongs to the token's user
      const email = getEmailById(result.userId!, attachment.email_id);
      if (!email) return reply.code(404).send('Attachment not found');

      // Resolve the path under the attachments root with a traversal guard
      const resolved = resolve(join(ATTACHMENTS_ROOT, attachment.storage_path));
      if (!resolved.startsWith(ATTACHMENTS_ROOT + sep)) {
        return reply.code(400).send('Invalid path');
      }
      if (!existsSync(resolved)) return reply.code(404).send('File missing');

      const stat = statSync(resolved);
      reply
        .header('Content-Type', attachment.mime_type || 'application/octet-stream')
        .header('Content-Length', String(stat.size))
        .header(
          'Content-Disposition',
          `inline; filename="${attachment.filename.replace(/"/g, '')}"`
        );
      return reply.send(createReadStream(resolved));
    }
  );

  // -------- Mutating POSTs: todo done / event remove ----------
  fastify.post<{ Params: { token: string; id: string } }>(
    '/view/:token/todo/:id/done',
    async (request, reply) => {
      const { token, id } = request.params;
      const todoId = Number.parseInt(id, 10);
      if (!Number.isFinite(todoId)) return reply.code(400).send('Invalid id');

      const result = validateTokenReadOnly(token);
      if (!result.valid) return reply.code(410).send('Link expired');

      const sessionUserId = getSessionUserId(request);
      if (!sessionUserId || sessionUserId !== result.userId) {
        return reply.code(401).type('text/html').send(
          renderNotFound('Please log in with the original account to mark this done.')
        );
      }

      markTodoAsDone(result.userId!, todoId);
      return reply.redirect(`${viewBase(token)}/todo/${todoId}`);
    }
  );

  fastify.post<{ Params: { token: string; id: string } }>(
    '/view/:token/event/:id/remove',
    async (request, reply) => {
      const { token, id } = request.params;
      const eventId = Number.parseInt(id, 10);
      if (!Number.isFinite(eventId)) return reply.code(400).send('Invalid id');

      const result = validateTokenReadOnly(token);
      if (!result.valid) return reply.code(410).send('Link expired');

      const sessionUserId = getSessionUserId(request);
      if (!sessionUserId || sessionUserId !== result.userId) {
        return reply.code(401).type('text/html').send(
          renderNotFound('Please log in with the original account to remove this event.')
        );
      }

      deleteEvent(result.userId!, eventId);
      return reply.redirect(`${viewBase(token)}/event/${eventId}`);
    }
  );
}
