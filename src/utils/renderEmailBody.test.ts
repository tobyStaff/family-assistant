// src/utils/renderEmailBody.test.ts
import { describe, it, expect } from 'vitest';
import { renderEmailBody } from './renderEmailBody.js';

describe('renderEmailBody', () => {
  it('returns an empty string for null/undefined/empty input', () => {
    expect(renderEmailBody('')).toBe('');
    expect(renderEmailBody(null as unknown as string)).toBe('');
    expect(renderEmailBody(undefined as unknown as string)).toBe('');
  });

  it('HTML-escapes dangerous characters', () => {
    const out = renderEmailBody('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('&lt;/script&gt;');
  });

  it('escapes quotes and ampersands', () => {
    const out = renderEmailBody(`She said "hi" & left`);
    expect(out).toContain('&quot;hi&quot;');
    expect(out).toContain('&amp;');
  });

  it('wraps paragraphs in <p> tags when separated by blank lines', () => {
    const out = renderEmailBody('First para.\n\nSecond para.');
    const paraCount = (out.match(/<p>/g) || []).length;
    expect(paraCount).toBe(2);
    expect(out).toContain('First para.');
    expect(out).toContain('Second para.');
  });

  it('converts single newlines inside a paragraph to <br>', () => {
    const out = renderEmailBody('Line one\nLine two');
    expect(out).toContain('Line one<br>Line two');
  });

  it('linkifies http and https URLs', () => {
    const out = renderEmailBody('Visit https://example.com now');
    expect(out).toContain('<a href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('>https://example.com</a>');
  });

  it('escapes raw HTML tags and linkifies URLs separately (no tag injection)', () => {
    const out = renderEmailBody('<a href="https://evil.com">click</a> and https://good.com');
    // Raw HTML brackets are escaped — no attacker-controlled anchor survives.
    expect(out).toContain('&lt;a href=');
    expect(out).toContain('&lt;/a&gt;');
    // Both URLs get linkified, which is safe: the surrounding markup is escaped
    // so the attacker-authored anchor text never runs as HTML.
    expect(out).toContain('<a href="https://evil.com"');
    expect(out).toContain('<a href="https://good.com"');
    // "click" appears as plain escaped text, not inside the attacker's anchor.
    expect(out).toContain('&gt;click&lt;/a&gt;');
  });

  it('preserves query-string ampersands in linkified URLs', () => {
    const out = renderEmailBody('Go to https://example.com/path?a=1&b=2 now');
    expect(out).toContain('<a href="https://example.com/path?a=1&amp;b=2"');
  });

  it('collapses 3+ blank lines into a single paragraph break', () => {
    const out = renderEmailBody('a\n\n\n\nb');
    const paraCount = (out.match(/<p>/g) || []).length;
    expect(paraCount).toBe(2);
  });

  it('trims leading/trailing whitespace from the whole input', () => {
    const out = renderEmailBody('\n\n  hello  \n\n');
    expect(out.startsWith('<p>')).toBe(true);
    expect(out.endsWith('</p>')).toBe(true);
  });
});
