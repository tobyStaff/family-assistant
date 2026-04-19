// src/templates/itemDetailTemplate.ts

import type { Todo } from '../types/todo.js';
import type { Event } from '../db/eventDb.js';
import type { StoredEmail } from '../db/emailDb.js';
import { getTodoTypeLabel, getTodoTypeEmoji } from '../types/extraction.js';
import { renderMobileLayout } from './mobileDetailLayout.js';

function esc(text: string | null | undefined): string {
  if (text === null || text === undefined) return '';
  return String(text).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[c] || c));
}

function formatWhen(date: Date | string | null | undefined): string {
  if (!date) return 'No date';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderSourceBreadcrumb(
  email: StoredEmail | null,
  viewBase: string
): string {
  if (!email) {
    return `<div class="source-breadcrumb"><span class="label">Source</span>Source email not available.</div>`;
  }
  const sender = email.from_name
    ? `${esc(email.from_name)} &lt;${esc(email.from_email)}&gt;`
    : esc(email.from_email);
  const received = new Date(email.date).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `
    <div class="source-breadcrumb">
      <span class="label">Source email</span>
      <div><strong>${sender}</strong></div>
      <div>${esc(email.subject)}</div>
      <div style="color:#7A8FA3;font-size:12px;">${received}</div>
      <div style="margin-top:8px;">
        <a href="${viewBase}/email/${email.id}">View original email →</a>
      </div>
    </div>`;
}

function renderRelatedList(
  relatedTodos: Todo[],
  relatedEvents: Event[],
  currentKind: 'todo' | 'event',
  currentId: number,
  viewBase: string
): string {
  if (relatedTodos.length === 0 && relatedEvents.length === 0) return '';

  const todoRows = relatedTodos
    .filter((t) => !(currentKind === 'todo' && t.id === currentId))
    .map((t) => {
      const struck = t.status === 'done' ? ' struck' : '';
      return `<li class="${struck.trim()}">
        <a href="${viewBase}/todo/${t.id}">
          ${getTodoTypeEmoji(t.type)} ${esc(t.description)}
        </a>
        ${t.status === 'done' ? '<span style="color:#7A8FA3;font-size:12px;">· done</span>' : ''}
      </li>`;
    })
    .join('');

  const eventRows = relatedEvents
    .filter((e) => !(currentKind === 'event' && e.id === currentId))
    .map((e) => {
      return `<li>
        <a href="${viewBase}/event/${e.id}">
          📅 ${esc(e.title)}
        </a>
      </li>`;
    })
    .join('');

  if (!todoRows && !eventRows) return '';

  return `
    <div class="card">
      <h3>Related items</h3>
      <ul class="related-list">
        ${todoRows}
        ${eventRows}
      </ul>
    </div>`;
}

function renderAiContext(analysisSummary: string | null | undefined, fallbackSubject: string): string {
  const text = (analysisSummary && analysisSummary.trim()) || fallbackSubject;
  if (!text) return '';
  return `<div class="card"><h3>Context</h3><p style="margin:0;">${esc(text)}</p></div>`;
}

export function renderTodoDetail(opts: {
  todo: Todo;
  sourceEmail: StoredEmail | null;
  analysisSummary: string | null;
  relatedTodos: Todo[];
  relatedEvents: Event[];
  viewBase: string; // e.g. /view/:token
  hasSession: boolean;
}): string {
  const { todo, sourceEmail, analysisSummary, relatedTodos, relatedEvents, viewBase, hasSession } = opts;

  const childBadge = todo.child_name && todo.child_name !== 'General'
    ? `<span class="child-badge">👶 ${esc(todo.child_name)}</span>`
    : '';

  const typeLine = `${getTodoTypeEmoji(todo.type)} <strong>${esc(getTodoTypeLabel(todo.type))}</strong>`;
  const whenLine = todo.due_date ? `⏰ ${esc(formatWhen(todo.due_date))}` : 'No due date';
  const statusLine = todo.status === 'done'
    ? `<div class="meta-line" style="color:#4CAF50;"><strong>✓ Done</strong></div>`
    : '';

  const actions = hasSession && todo.status !== 'done'
    ? `<div style="margin-top:16px;">
        <form class="inline-action" method="POST" action="${viewBase}/todo/${todo.id}/done">
          <button type="submit" class="btn btn-primary">✓ Mark done</button>
        </form>
      </div>`
    : '';

  const content = `
    <div class="card">
      <div class="meta-line">${typeLine} ${childBadge}</div>
      <h1>${esc(todo.description)}</h1>
      <div class="meta-line">${whenLine}</div>
      ${statusLine}
      ${actions}
    </div>
    ${renderAiContext(analysisSummary, sourceEmail?.subject ?? '')}
    ${renderSourceBreadcrumb(sourceEmail, viewBase)}
    ${renderRelatedList(relatedTodos, relatedEvents, 'todo', todo.id, viewBase)}
  `;

  return renderMobileLayout({
    title: `Todo: ${todo.description.slice(0, 60)}`,
    content,
  });
}

export function renderEventDetail(opts: {
  event: Event;
  sourceEmail: StoredEmail | null;
  analysisSummary: string | null;
  relatedTodos: Todo[];
  relatedEvents: Event[];
  viewBase: string;
  hasSession: boolean;
}): string {
  const { event, sourceEmail, analysisSummary, relatedTodos, relatedEvents, viewBase, hasSession } = opts;

  const childBadge = event.child_name && event.child_name !== 'General'
    ? `<span class="child-badge">👶 ${esc(event.child_name)}</span>`
    : '';

  const whenLine = `📅 ${esc(formatWhen(event.date))}`;
  const locationLine = event.location
    ? `<div class="meta-line">📍 ${esc(event.location)}</div>`
    : '';
  const descLine = event.description
    ? `<div class="meta-line">${esc(event.description)}</div>`
    : '';

  const actions = hasSession
    ? `<div style="margin-top:16px;">
        <form class="inline-action" method="POST" action="${viewBase}/event/${event.id}/remove">
          <button type="submit" class="btn btn-danger">✕ Remove event</button>
        </form>
      </div>`
    : '';

  const content = `
    <div class="card">
      <div class="meta-line">${childBadge}</div>
      <h1>${esc(event.title)}</h1>
      <div class="meta-line">${whenLine}</div>
      ${locationLine}
      ${descLine}
      ${actions}
    </div>
    ${renderAiContext(analysisSummary, sourceEmail?.subject ?? '')}
    ${renderSourceBreadcrumb(sourceEmail, viewBase)}
    ${renderRelatedList(relatedTodos, relatedEvents, 'event', event.id, viewBase)}
  `;

  return renderMobileLayout({
    title: `Event: ${event.title.slice(0, 60)}`,
    content,
  });
}

export function renderNotFound(message: string): string {
  return renderMobileLayout({
    title: 'Not found',
    content: `<div class="card"><h1>Not found</h1><p>${esc(message)}</p></div>`,
  });
}

export function renderExpired(): string {
  return renderMobileLayout({
    title: 'Link expired',
    content: `<div class="card"><h1>Link expired</h1><p>This link has expired. Check your latest Family Briefing email for a fresh one.</p></div>`,
  });
}
