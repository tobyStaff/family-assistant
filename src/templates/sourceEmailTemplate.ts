// src/templates/sourceEmailTemplate.ts

import type { StoredEmail } from '../db/emailDb.js';
import type { StoredAttachment } from '../db/attachmentDb.js';
import { renderMobileLayout } from './mobileDetailLayout.js';
import { renderEmailBody } from '../utils/renderEmailBody.js';

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

function formatBytes(size: number | null | undefined): string {
  if (!size || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function renderSourceEmail(opts: {
  email: StoredEmail;
  attachments: StoredAttachment[];
  viewBase: string;
  backHref?: string; // optional breadcrumb back to the item they came from
}): string {
  const { email, attachments, viewBase, backHref } = opts;

  const sender = email.from_name
    ? `${esc(email.from_name)} &lt;${esc(email.from_email)}&gt;`
    : esc(email.from_email);

  const received = new Date(email.date).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const body = renderEmailBody(email.body_text || '');

  const attachmentFiles = attachments.length > 0
    ? `<div class="card">
        <h3>Attachment files</h3>
        <ul class="attachments-list">
          ${attachments.map((a) => {
            const size = formatBytes(a.size);
            const status = a.extraction_status === 'failed' ? ' <span style="color:#c62828;font-size:12px;">(extraction failed)</span>' : '';
            return `<li>
              📎 <a href="${viewBase}/attachment/${a.id}">${esc(a.filename)}</a>
              ${size ? `<span style="color:#7A8FA3;font-size:12px;">· ${size}</span>` : ''}
              ${status}
            </li>`;
          }).join('')}
        </ul>
      </div>`
    : '';

  const breadcrumb = backHref
    ? `<a href="${esc(backHref)}">← Back to item</a>`
    : '';

  // Blog-style typography applied only on L3. Scoped to .prose-body so it
  // does not bleed into L2 or the email template.
  const proseStyles = `
    <style>
      .prose-body { max-width: 640px; font-size: 18px; line-height: 1.7; }
      .prose-body p { margin: 0 0 24px 0; }
      .prose-body p:last-child { margin-bottom: 0; }
      .prose-body ul,
      .prose-body ol { margin: 0 0 24px 0; padding-left: 24px; }
      .prose-body li { margin-bottom: 8px; }
      .prose-body li:last-child { margin-bottom: 0; }
      .prose-body a { color: #2A5C82; text-decoration: underline; text-underline-offset: 2px; }
    </style>
  `;

  const content = `
    ${proseStyles}
    <div class="card">
      <h3>From</h3>
      <div class="meta-line">${sender}</div>
      <h3 style="margin-top:16px;">Subject</h3>
      <div class="meta-line">${esc(email.subject)}</div>
      <h3 style="margin-top:16px;">Received</h3>
      <div class="meta-line">${received}</div>
    </div>
    <div class="card">
      <h3>Body</h3>
      <div class="email-body prose-body">${body || '<p style="color:#7A8FA3;">No body text stored.</p>'}</div>
    </div>
    ${attachmentFiles}
  `;

  return renderMobileLayout({
    title: `Email: ${email.subject.slice(0, 60)}`,
    breadcrumb,
    content,
  });
}
