// src/templates/inboxContent.ts

import type { StoredEmail } from '../db/emailDb.js';
import { renderEmailBody } from '../utils/renderEmailBody.js';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;',
};

function esc(text: string | null | undefined): string {
  if (text === null || text === undefined) return '';
  return String(text).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] || c);
}

function formatRowDate(date: Date): string {
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDetailDate(date: Date): string {
  return date.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function senderDisplay(email: StoredEmail): string {
  return email.from_name && email.from_name.trim()
    ? email.from_name
    : email.from_email;
}

const SHARED_STYLES = `
  <style>
    .inbox-empty {
      background: white;
      padding: 60px 24px;
      border-radius: 12px;
      text-align: center;
      color: #666;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
    }
    .inbox-empty-icon { font-size: 48px; margin-bottom: 12px; }
    .inbox-empty h2 { margin-bottom: 8px; color: #333; }

    .inbox-list {
      background: white;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
    }
    .inbox-row {
      display: grid;
      grid-template-columns: 220px 1fr 130px;
      gap: 16px;
      padding: 14px 18px;
      border-bottom: 1px solid #eef0f2;
      text-decoration: none;
      color: inherit;
      transition: background 0.15s;
    }
    .inbox-row:last-child { border-bottom: none; }
    .inbox-row:hover { background: #f7f9fb; }
    .inbox-sender {
      font-weight: 600;
      color: #2A5C82;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .inbox-main { min-width: 0; }
    .inbox-subject {
      font-weight: 600;
      color: #1a1a1a;
      margin-bottom: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .inbox-snippet {
      color: #666;
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .inbox-date {
      color: #7A8FA3;
      font-size: 13px;
      text-align: right;
      white-space: nowrap;
    }

    @media (max-width: 720px) {
      .inbox-row {
        grid-template-columns: 1fr 90px;
        grid-template-areas:
          "sender date"
          "main main";
      }
      .inbox-sender { grid-area: sender; }
      .inbox-date { grid-area: date; }
      .inbox-main { grid-area: main; }
    }

    .inbox-detail-card {
      background: white;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 16px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
    }
    .inbox-detail-meta { color: #5A6A7A; font-size: 14px; margin-bottom: 8px; }
    .inbox-detail-meta strong { color: #1a1a1a; }
    .inbox-detail-subject {
      font-size: 22px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 12px;
    }
    .inbox-back {
      display: inline-block;
      margin-bottom: 16px;
      color: #2A5C82;
      text-decoration: none;
      font-size: 14px;
    }
    .inbox-back:hover { text-decoration: underline; }

    .inbox-body { max-width: 720px; font-size: 16px; line-height: 1.65; color: #1a1a1a; }
    .inbox-body p { margin: 0 0 18px 0; }
    .inbox-body p:last-child { margin-bottom: 0; }
    .inbox-body ul,
    .inbox-body ol { margin: 0 0 18px 0; padding-left: 22px; }
    .inbox-body li { margin-bottom: 6px; }
    .inbox-body a { color: #2A5C82; text-decoration: underline; text-underline-offset: 2px; }
    .inbox-body-empty { color: #7A8FA3; font-style: italic; }
  </style>
`;

export interface InboxListContentOptions {
  emails: StoredEmail[];
}

export function renderInboxListContent(options: InboxListContentOptions): string {
  const { emails } = options;

  if (emails.length === 0) {
    return `
      ${SHARED_STYLES}
      <div class="inbox-empty">
        <div class="inbox-empty-icon">📥</div>
        <h2>No forwarded emails yet</h2>
        <p>Emails forwarded to your aliased address will appear here.</p>
      </div>
    `;
  }

  const rowsHtml = emails.map((email) => {
    const preview = email.snippet || email.body_text || '';
    return `
      <a href="/inbox/${email.id}" class="inbox-row">
        <div class="inbox-sender">${esc(senderDisplay(email))}</div>
        <div class="inbox-main">
          <div class="inbox-subject">${esc(email.subject) || '(no subject)'}</div>
          <div class="inbox-snippet">${esc(preview)}</div>
        </div>
        <div class="inbox-date">${formatRowDate(email.date)}</div>
      </a>
    `;
  }).join('');

  return `
    ${SHARED_STYLES}
    <div class="inbox-list">
      ${rowsHtml}
    </div>
  `;
}

export interface InboxDetailContentOptions {
  email: StoredEmail;
}

export function renderInboxDetailContent(options: InboxDetailContentOptions): string {
  const { email } = options;
  const sender = email.from_name
    ? `${esc(email.from_name)} &lt;${esc(email.from_email)}&gt;`
    : esc(email.from_email);
  const body = renderEmailBody(email.body_text || '');

  return `
    ${SHARED_STYLES}
    <a href="/inbox" class="inbox-back">← Back to Inbox</a>
    <div class="inbox-detail-card">
      <div class="inbox-detail-subject">${esc(email.subject) || '(no subject)'}</div>
      <div class="inbox-detail-meta"><strong>From:</strong> ${sender}</div>
      <div class="inbox-detail-meta"><strong>Received:</strong> ${formatDetailDate(email.date)}</div>
    </div>
    <div class="inbox-detail-card">
      <div class="inbox-body">
        ${body || '<p class="inbox-body-empty">No body text stored.</p>'}
      </div>
    </div>
  `;
}
