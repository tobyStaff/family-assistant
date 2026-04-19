// src/routes/detailRoutes.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { createTestDb } from '../tests/createTestDb.js';

const testDb = createTestDb();

vi.mock('../db/db.js', () => ({ default: testDb }));

// Import route + DB helpers after the mock is registered.
const { detailRoutes } = await import('./detailRoutes.js');
const { createViewToken } = await import('../db/emailActionTokenDb.js');

async function buildTestApp(sessionUserId: string | null = null): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  // Lightweight session shim — just sets request.userId if provided.
  app.addHook('onRequest', async (request) => {
    if (sessionUserId) (request as any).userId = sessionUserId;
  });
  await app.register(detailRoutes);
  await app.ready();
  return app;
}

function insertEmail(
  userId: string,
  gmailMessageId: string,
  overrides: Partial<{ subject: string; body_text: string; from_email: string; from_name: string; date: string; }> = {}
): number {
  const result = testDb.prepare(`
    INSERT INTO emails (user_id, gmail_message_id, from_email, from_name, subject, date, body_text, source_type, source_message_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'gmail', ?)
  `).run(
    userId,
    gmailMessageId,
    overrides.from_email ?? 'school@example.com',
    overrides.from_name ?? 'Example School',
    overrides.subject ?? 'Trip next week',
    overrides.date ?? '2025-04-10T09:00:00Z',
    overrides.body_text ?? 'Please sign the consent form. Link: https://pay.example.com/abc',
    gmailMessageId
  );
  return result.lastInsertRowid as number;
}

function insertTodo(userId: string, sourceEmailId: string, description: string, status: 'pending' | 'done' = 'pending'): number {
  const result = testDb.prepare(`
    INSERT INTO todos (user_id, description, type, status, source_email_id)
    VALUES (?, ?, 'SIGN', ?, ?)
  `).run(userId, description, status, sourceEmailId);
  return result.lastInsertRowid as number;
}

function insertEvent(userId: string, sourceEmailId: string, title: string): number {
  const result = testDb.prepare(`
    INSERT INTO events (user_id, title, date, source_email_id, child_name, sync_status)
    VALUES (?, ?, '2025-04-14T09:00:00Z', ?, 'Ella', 'pending')
  `).run(userId, title, sourceEmailId);
  return result.lastInsertRowid as number;
}

beforeEach(() => {
  testDb.exec('DELETE FROM email_action_tokens');
  testDb.exec('DELETE FROM todos');
  testDb.exec('DELETE FROM events');
  testDb.exec('DELETE FROM email_analyses');
  testDb.exec('DELETE FROM email_attachments');
  testDb.exec('DELETE FROM emails');
  testDb.exec('DELETE FROM users');
  testDb.prepare('INSERT INTO users (user_id, email) VALUES (?, ?)').run('user-1', 'u1@example.com');
  testDb.prepare('INSERT INTO users (user_id, email) VALUES (?, ?)').run('user-2', 'u2@example.com');
});

describe('GET /view/:token/todo/:id', () => {
  it('returns 200 with the todo rendered when the token is valid', async () => {
    const emailId = insertEmail('user-1', 'gmail-msg-1');
    const todoId = insertTodo('user-1', 'gmail-msg-1', 'Sign consent form');
    const token = createViewToken('user-1');

    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/view/${token}/todo/${todoId}` });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Sign consent form');
    // Source breadcrumb visible
    expect(res.body).toContain('Example School');
    expect(res.body).toContain('Trip next week');
    // L3 link uses the resolved emails.id
    expect(res.body).toContain(`/view/${token}/email/${emailId}`);
    await app.close();
  });

  it('hides the Mark done button when there is no session', async () => {
    const todoId = insertTodo('user-1', 'gmail-msg-1', 'Do the thing');
    insertEmail('user-1', 'gmail-msg-1');
    const token = createViewToken('user-1');

    const app = await buildTestApp(/* no session */);
    const res = await app.inject({ method: 'GET', url: `/view/${token}/todo/${todoId}` });

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('Mark done');
    await app.close();
  });

  it('shows the Mark done button when the session matches the token owner', async () => {
    const todoId = insertTodo('user-1', 'gmail-msg-1', 'Do the thing');
    insertEmail('user-1', 'gmail-msg-1');
    const token = createViewToken('user-1');

    const app = await buildTestApp('user-1');
    const res = await app.inject({ method: 'GET', url: `/view/${token}/todo/${todoId}` });

    expect(res.body).toContain('Mark done');
    await app.close();
  });

  it('does NOT show the Mark done button when a different user is logged in', async () => {
    const todoId = insertTodo('user-1', 'gmail-msg-1', 'Do the thing');
    insertEmail('user-1', 'gmail-msg-1');
    const token = createViewToken('user-1');

    const app = await buildTestApp('user-2');
    const res = await app.inject({ method: 'GET', url: `/view/${token}/todo/${todoId}` });

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('Mark done');
    await app.close();
  });

  it('returns 410 when the token has expired', async () => {
    const todoId = insertTodo('user-1', 'gmail-msg-1', 'Do the thing');
    insertEmail('user-1', 'gmail-msg-1');
    const pastExpiry = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    testDb.prepare(`
      INSERT INTO email_action_tokens (token, user_id, action_type, target_id, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('expired-token', 'user-1', 'view_summary', null, pastExpiry);

    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/view/expired-token/todo/${todoId}` });

    expect(res.statusCode).toBe(410);
    expect(res.body).toContain('Link expired');
    await app.close();
  });

  it('returns 404 when the todo belongs to a different user', async () => {
    const todoId = insertTodo('user-2', 'gmail-msg-1', 'Not yours');
    const token = createViewToken('user-1'); // token is for user-1
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/view/${token}/todo/${todoId}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('lists related todos and events from the same source email', async () => {
    const emailId = insertEmail('user-1', 'gmail-msg-1');
    const todoId = insertTodo('user-1', 'gmail-msg-1', 'Sign consent');
    insertTodo('user-1', 'gmail-msg-1', 'Pay £10 for coach', 'done');
    insertEvent('user-1', 'gmail-msg-1', 'School trip');
    const token = createViewToken('user-1');

    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/view/${token}/todo/${todoId}` });

    expect(res.body).toContain('Pay £10 for coach');
    expect(res.body).toContain('School trip');
    // Done item has the struck class
    expect(res.body).toContain('struck');
    expect(emailId).toBeGreaterThan(0);
    await app.close();
  });
});

describe('GET /view/:token/attachment/:id', () => {
  const attachmentsRoot = resolve(process.cwd(), 'data', 'attachments');
  const testFileRel = `test-user/integration-test-file.txt`;
  const testFileAbs = join(attachmentsRoot, testFileRel);

  beforeEach(() => {
    mkdirSync(join(attachmentsRoot, 'test-user'), { recursive: true });
    writeFileSync(testFileAbs, 'hello attachment body');
  });

  afterAll(() => {
    if (existsSync(testFileAbs)) rmSync(testFileAbs);
  });

  it('serves a file with the correct mime type when the token is valid', async () => {
    const emailId = insertEmail('user-1', 'gmail-msg-x');
    const res1 = testDb.prepare(`
      INSERT INTO email_attachments (email_id, filename, mime_type, size, storage_path, extraction_status)
      VALUES (?, ?, ?, ?, ?, 'success')
    `).run(emailId, 'body.txt', 'text/plain', 21, testFileRel);
    const attId = res1.lastInsertRowid as number;
    const token = createViewToken('user-1');

    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/view/${token}/attachment/${attId}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/plain');
    expect(res.body).toContain('hello attachment body');
    await app.close();
  });

  it('rejects path traversal via the storage_path column', async () => {
    const emailId = insertEmail('user-1', 'gmail-msg-y');
    const res1 = testDb.prepare(`
      INSERT INTO email_attachments (email_id, filename, mime_type, size, storage_path, extraction_status)
      VALUES (?, ?, ?, ?, ?, 'success')
    `).run(emailId, 'evil.txt', 'text/plain', 10, '../../../etc/passwd');
    const attId = res1.lastInsertRowid as number;
    const token = createViewToken('user-1');

    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/view/${token}/attachment/${attId}` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects access when the token belongs to a different user', async () => {
    const emailId = insertEmail('user-1', 'gmail-msg-z');
    const res1 = testDb.prepare(`
      INSERT INTO email_attachments (email_id, filename, mime_type, size, storage_path, extraction_status)
      VALUES (?, ?, ?, ?, ?, 'success')
    `).run(emailId, 'body.txt', 'text/plain', 21, testFileRel);
    const attId = res1.lastInsertRowid as number;
    const token = createViewToken('user-2'); // wrong user's token

    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/view/${token}/attachment/${attId}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns 410 when the token has expired', async () => {
    const pastExpiry = new Date(Date.now() - 1000).toISOString();
    testDb.prepare(`
      INSERT INTO email_action_tokens (token, user_id, action_type, target_id, expires_at)
      VALUES ('expired-att', 'user-1', 'view_summary', NULL, ?)
    `).run(pastExpiry);
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/view/expired-att/attachment/1` });
    expect(res.statusCode).toBe(410);
    await app.close();
  });
});

describe('POST /view/:token/todo/:id/done', () => {
  it('marks the todo as done when token + owning session match, then redirects', async () => {
    const todoId = insertTodo('user-1', 'gmail-msg-1', 'Please mark me');
    const token = createViewToken('user-1');

    const app = await buildTestApp('user-1');
    const res = await app.inject({ method: 'POST', url: `/view/${token}/todo/${todoId}/done` });

    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe(`/view/${token}/todo/${todoId}`);

    const row = testDb.prepare('SELECT status FROM todos WHERE id = ?').get(todoId) as any;
    expect(row.status).toBe('done');
    await app.close();
  });

  it('returns 401 when there is no session', async () => {
    const todoId = insertTodo('user-1', 'gmail-msg-1', 'No session');
    const token = createViewToken('user-1');

    const app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: `/view/${token}/todo/${todoId}/done` });
    expect(res.statusCode).toBe(401);

    const row = testDb.prepare('SELECT status FROM todos WHERE id = ?').get(todoId) as any;
    expect(row.status).toBe('pending');
    await app.close();
  });

  it('returns 401 when the session user does not own the token', async () => {
    const todoId = insertTodo('user-1', 'gmail-msg-1', 'Other user');
    const token = createViewToken('user-1');

    const app = await buildTestApp('user-2');
    const res = await app.inject({ method: 'POST', url: `/view/${token}/todo/${todoId}/done` });
    expect(res.statusCode).toBe(401);

    const row = testDb.prepare('SELECT status FROM todos WHERE id = ?').get(todoId) as any;
    expect(row.status).toBe('pending');
    await app.close();
  });

  it('returns 410 when the token has expired', async () => {
    const todoId = insertTodo('user-1', 'gmail-msg-1', 'Expired token');
    const pastExpiry = new Date(Date.now() - 1000).toISOString();
    testDb.prepare(`
      INSERT INTO email_action_tokens (token, user_id, action_type, target_id, expires_at)
      VALUES ('expired-done', 'user-1', 'view_summary', NULL, ?)
    `).run(pastExpiry);

    const app = await buildTestApp('user-1');
    const res = await app.inject({ method: 'POST', url: `/view/expired-done/todo/${todoId}/done` });
    expect(res.statusCode).toBe(410);
    await app.close();
  });
});

describe('POST /view/:token/event/:id/remove', () => {
  it('deletes the event when token + owning session match, then redirects', async () => {
    const eventId = insertEvent('user-1', 'gmail-msg-1', 'School trip');
    const token = createViewToken('user-1');

    const app = await buildTestApp('user-1');
    const res = await app.inject({ method: 'POST', url: `/view/${token}/event/${eventId}/remove` });

    expect(res.statusCode).toBe(302);
    const row = testDb.prepare('SELECT id FROM events WHERE id = ?').get(eventId);
    expect(row).toBeUndefined();
    await app.close();
  });

  it('returns 401 without a session', async () => {
    const eventId = insertEvent('user-1', 'gmail-msg-1', 'Stays put');
    const token = createViewToken('user-1');

    const app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: `/view/${token}/event/${eventId}/remove` });
    expect(res.statusCode).toBe(401);

    const row = testDb.prepare('SELECT id FROM events WHERE id = ?').get(eventId);
    expect(row).toBeDefined();
    await app.close();
  });
});

describe('GET /view/:token/email/:emailId', () => {
  it('renders body text and attachments list', async () => {
    const emailId = insertEmail('user-1', 'gmail-msg-1', {
      body_text: 'Hello.\n\nClick https://example.com to pay.',
    });
    testDb.prepare(`
      INSERT INTO email_attachments (email_id, filename, mime_type, size, storage_path, extraction_status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(emailId, 'consent-form.pdf', 'application/pdf', 12345, 'user-1/att-1.pdf', 'success');
    const token = createViewToken('user-1');

    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/view/${token}/email/${emailId}` });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('consent-form.pdf');
    expect(res.body).toContain('href="https://example.com"');
    expect(res.body).toContain(`/view/${token}/attachment/`);
    await app.close();
  });

  it('renders a "back to item" breadcrumb when ?from=todo:123 is passed', async () => {
    const emailId = insertEmail('user-1', 'gmail-msg-1');
    const token = createViewToken('user-1');

    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/view/${token}/email/${emailId}?from=todo:42` });
    expect(res.body).toContain(`${token}/todo/42`);
    expect(res.body).toContain('Back to item');
    await app.close();
  });

  it('ignores a malformed ?from query', async () => {
    const emailId = insertEmail('user-1', 'gmail-msg-1');
    const token = createViewToken('user-1');

    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/view/${token}/email/${emailId}?from=../../../etc/passwd` });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('passwd');
    await app.close();
  });
});
