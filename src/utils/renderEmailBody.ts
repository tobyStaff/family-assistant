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

// Reply-chain boundaries — everything from this line onwards is discarded.
// Gmail/Apple: "On <date>, <person> wrote:"  —  loose pattern, case-sensitive "On" at line start.
// Outlook: "-----Original Message-----"
const REPLY_HEADER_RE = /^On .+ wrote:\s*$/;
const ORIGINAL_MESSAGE_RE = /^-+\s*Original Message\s*-+\s*$/i;

// Line-level quoted-reply marker: `> foo`, `>> foo`, `>foo`.
const QUOTED_LINE_RE = /^>+\s?/;

// List item patterns
const BULLET_RE = /^[-*•]\s+(.*)$/;
const NUMBERED_RE = /^\d+[.)]\s+(.*)$/;

/**
 * Linkify URLs inside a single plain-text fragment, escaping non-URL pieces.
 * Splits the fragment around URL matches, escape-encodes the non-URL slices,
 * escape-encodes the URL into the href, and wraps in <a>. Safe: raw HTML
 * entering this function becomes inert text.
 */
function linkifyFragment(text: string): string {
  const parts: string[] = [];
  let lastIdx = 0;

  for (const match of text.matchAll(URL_RE)) {
    const start = match.index!;
    parts.push(escapeHtml(text.slice(lastIdx, start)));

    let url = match[0];
    let tail = '';
    const trailing = url.match(TRAILING_PUNCT_RE);
    if (trailing) {
      tail = trailing[0];
      url = url.slice(0, -tail.length);
    }
    const safeUrl = escapeHtml(url);
    parts.push(`<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>`);
    if (tail) parts.push(escapeHtml(tail));

    lastIdx = start + match[0].length;
  }

  parts.push(escapeHtml(text.slice(lastIdx)));
  return parts.join('');
}

/**
 * Truncate the body at the first reply-chain marker. Emails typically bury
 * reply history at the very end, so we chop everything from the marker on.
 * Returns the kept portion (may be empty if the marker is at line 0).
 */
function truncateAtReplyHeader(body: string): string {
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (REPLY_HEADER_RE.test(line) || ORIGINAL_MESSAGE_RE.test(line)) {
      return lines.slice(0, i).join('\n').trimEnd();
    }
  }
  return body;
}

/**
 * Strip lines that look like quoted replies (`> …`, `>> …`). Orphaned quote
 * blocks left behind by odd mail clients will be removed entirely. Running
 * this after truncateAtReplyHeader catches interleaved quotes and stragglers.
 */
function stripQuotedLines(body: string): string {
  return body
    .split('\n')
    .filter((line) => !QUOTED_LINE_RE.test(line))
    .join('\n');
}

type Chunk = { kind: 'prose'; lines: string[] } | { kind: 'ul' | 'ol'; items: string[] };

/**
 * Classify a paragraph chunk (array of non-empty lines) as a bullet list,
 * numbered list, or reflowed prose. Lists require **every** line to match;
 * partial matches fall through to prose (safer default).
 */
function classifyChunk(lines: string[]): Chunk {
  const allBullet = lines.every((l) => BULLET_RE.test(l));
  if (allBullet) {
    return { kind: 'ul', items: lines.map((l) => l.replace(BULLET_RE, '$1')) };
  }
  const allNumbered = lines.every((l) => NUMBERED_RE.test(l));
  if (allNumbered) {
    return { kind: 'ol', items: lines.map((l) => l.replace(NUMBERED_RE, '$1')) };
  }
  return { kind: 'prose', lines };
}

function renderChunk(chunk: Chunk): string {
  if (chunk.kind === 'prose') {
    // Prose: soft-wraps collapse into spaces.
    return `<p>${linkifyFragment(chunk.lines.join(' '))}</p>`;
  }
  const items = chunk.items.map((item) => `<li>${linkifyFragment(item)}</li>`).join('');
  return `<${chunk.kind}>${items}</${chunk.kind}>`;
}

/**
 * Render a plaintext email body as sanitised blog-style HTML.
 *
 * Pipeline:
 *   1. Truncate at first reply-chain marker (Gmail / Outlook styles)
 *   2. Drop `>`-prefixed lines (interleaved or orphan quotes)
 *   3. Split into paragraph chunks on blank-line runs
 *   4. Classify each chunk as bullet list / numbered list / prose
 *   5. Prose chunks: single newlines collapse to spaces (reflow)
 *   6. Escape + linkify (same XSS guarantees as before)
 */
export function renderEmailBody(plain: string | null | undefined): string {
  if (!plain) return '';

  let body = plain.trim();
  if (!body) return '';

  body = truncateAtReplyHeader(body);
  body = stripQuotedLines(body);

  const chunks = body
    .split(/\n{2,}/)
    .map((chunk) =>
      chunk.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
    )
    .filter((lines) => lines.length > 0);

  if (chunks.length === 0) return '';

  return chunks.map(classifyChunk).map(renderChunk).join('\n');
}
