// src/utils/renderEmailBody.ts

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// Conservative URL regex: http(s)://…, stops at whitespace or HTML-significant chars.
const URL_RE = /https?:\/\/[^\s<>"']+/g;
const TRAILING_PUNCT_RE = /[.,;:!?)\]}>]+$/;

/**
 * Render a single paragraph: linkify URLs and escape everything else.
 * URLs are split out first so escape cannot corrupt query-string ampersands.
 */
function renderParagraph(text: string): string {
  const parts: string[] = [];
  let lastIdx = 0;

  for (const match of text.matchAll(URL_RE)) {
    const start = match.index!;
    const before = text.slice(lastIdx, start);
    parts.push(escapeHtml(before).replace(/\n/g, '<br>'));

    let url = match[0];
    let tail = '';
    const trailing = url.match(TRAILING_PUNCT_RE);
    if (trailing) {
      tail = trailing[0];
      url = url.slice(0, -tail.length);
    }
    const safeUrl = escapeHtml(url);
    parts.push(
      `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>`
    );
    if (tail) parts.push(escapeHtml(tail));

    lastIdx = start + match[0].length;
  }

  parts.push(escapeHtml(text.slice(lastIdx)).replace(/\n/g, '<br>'));
  return parts.join('');
}

/**
 * Render a plaintext email body as sanitised mobile-friendly HTML.
 *
 * Pipeline:
 *   1. Trim and split on blank-line runs into paragraphs
 *   2. For each paragraph, split on URLs, escape non-URL text, escape and wrap URLs in <a>
 *   3. Replace single newlines with <br> inside the escaped non-URL fragments
 *   4. Wrap each paragraph in <p>
 */
export function renderEmailBody(plain: string | null | undefined): string {
  if (!plain) return '';

  const trimmed = plain.trim();
  if (!trimmed) return '';

  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return paragraphs.map((p) => `<p>${renderParagraph(p)}</p>`).join('\n');
}
