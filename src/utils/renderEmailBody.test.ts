// src/utils/renderEmailBody.test.ts
import { describe, it, expect } from 'vitest';
import { renderEmailBody } from './renderEmailBody.js';

describe('renderEmailBody', () => {
  describe('empty input', () => {
    it('returns empty string for null/undefined/empty', () => {
      expect(renderEmailBody('')).toBe('');
      expect(renderEmailBody(null as unknown as string)).toBe('');
      expect(renderEmailBody(undefined as unknown as string)).toBe('');
      expect(renderEmailBody('   \n\n  ')).toBe('');
    });
  });

  describe('prose reflow', () => {
    it('joins soft-wrapped lines within a paragraph into one line (space-joined)', () => {
      const out = renderEmailBody('Line one\nLine two\nLine three');
      expect(out).toContain('<p>Line one Line two Line three</p>');
      expect(out).not.toContain('<br>');
    });

    it('keeps blank lines as paragraph breaks', () => {
      const out = renderEmailBody('Para 1 first line\nPara 1 second line\n\nPara 2');
      const paraCount = (out.match(/<p>/g) || []).length;
      expect(paraCount).toBe(2);
      expect(out).toContain('Para 1 first line Para 1 second line');
      expect(out).toContain('Para 2');
    });

    it('collapses 3+ blank lines into a single paragraph break', () => {
      const out = renderEmailBody('a\n\n\n\nb');
      const paraCount = (out.match(/<p>/g) || []).length;
      expect(paraCount).toBe(2);
    });
  });

  describe('HTML escape', () => {
    it('escapes dangerous characters', () => {
      const out = renderEmailBody('<script>alert(1)</script>');
      expect(out).not.toContain('<script>');
      expect(out).toContain('&lt;script&gt;');
    });

    it('escapes raw HTML tags and linkifies URLs separately', () => {
      const out = renderEmailBody('<a href="https://evil.com">click</a> https://good.com');
      expect(out).toContain('&lt;a href=');
      expect(out).toContain('<a href="https://good.com"');
    });
  });

  describe('URL linkification', () => {
    it('linkifies http and https URLs', () => {
      const out = renderEmailBody('Visit https://example.com');
      expect(out).toContain('<a href="https://example.com"');
      expect(out).toContain('rel="noopener noreferrer"');
      expect(out).toContain('target="_blank"');
    });

    it('preserves query-string ampersands', () => {
      const out = renderEmailBody('Go to https://example.com/path?a=1&b=2 now');
      expect(out).toContain('<a href="https://example.com/path?a=1&amp;b=2"');
    });
  });

  describe('bullet lists', () => {
    it('renders a dash-bulleted chunk as <ul>', () => {
      const out = renderEmailBody('- apple\n- banana\n- cherry');
      expect(out).toContain('<ul>');
      expect(out).toContain('<li>apple</li>');
      expect(out).toContain('<li>banana</li>');
      expect(out).toContain('<li>cherry</li>');
    });

    it('renders an asterisk-bulleted chunk as <ul>', () => {
      const out = renderEmailBody('* one\n* two');
      expect(out).toContain('<ul>');
      expect(out).toContain('<li>one</li>');
      expect(out).toContain('<li>two</li>');
    });

    it('renders a bullet-character list as <ul>', () => {
      const out = renderEmailBody('• alpha\n• beta');
      expect(out).toContain('<ul>');
      expect(out).toContain('<li>alpha</li>');
      expect(out).toContain('<li>beta</li>');
    });
  });

  describe('numbered lists', () => {
    it('renders a numbered chunk with dots as <ol>', () => {
      const out = renderEmailBody('1. first\n2. second\n3. third');
      expect(out).toContain('<ol>');
      expect(out).toContain('<li>first</li>');
      expect(out).toContain('<li>second</li>');
      expect(out).toContain('<li>third</li>');
    });

    it('renders a numbered chunk with closing parens as <ol>', () => {
      const out = renderEmailBody('1) first\n2) second');
      expect(out).toContain('<ol>');
      expect(out).toContain('<li>first</li>');
      expect(out).toContain('<li>second</li>');
    });
  });

  describe('mixed chunks (safer default)', () => {
    it('treats a chunk with prose followed by bullets as reflowed prose, not a list', () => {
      const out = renderEmailBody('Buy:\n- apple\n- banana');
      expect(out).not.toContain('<ul>');
      expect(out).not.toContain('<li>');
      expect(out).toContain('<p>');
    });
  });

  describe('quoted replies', () => {
    it('drops a line prefixed with >', () => {
      const out = renderEmailBody('> previous content\nHi there');
      expect(out).toContain('Hi there');
      expect(out).not.toContain('previous content');
    });

    it('drops deeper-nested quote prefixes too', () => {
      const out = renderEmailBody('>> deep quote\n> outer quote\nActive message');
      expect(out).toContain('Active message');
      expect(out).not.toContain('deep quote');
      expect(out).not.toContain('outer quote');
    });
  });

  describe('reply-chain truncation', () => {
    it('truncates at a Gmail-style "On … wrote:" header', () => {
      const input = [
        'Thanks for the note.',
        '',
        'On Mon, Apr 15, 2024 at 10:30 AM Joe <joe@example.com> wrote:',
        '> some old reply',
        '> more old reply',
      ].join('\n');
      const out = renderEmailBody(input);
      expect(out).toContain('Thanks for the note.');
      expect(out).not.toContain('wrote:');
      expect(out).not.toContain('old reply');
      expect(out).not.toContain('Joe');
    });

    it('truncates at an Outlook-style "Original Message" marker', () => {
      const input = [
        'See below.',
        '',
        '-----Original Message-----',
        'From: Someone',
        'Subject: Old subject',
      ].join('\n');
      const out = renderEmailBody(input);
      expect(out).toContain('See below.');
      expect(out).not.toContain('Original Message');
      expect(out).not.toContain('Someone');
      expect(out).not.toContain('Old subject');
    });
  });

  describe('whitespace handling', () => {
    it('trims leading and trailing whitespace', () => {
      const out = renderEmailBody('\n\n  hello  \n\n');
      expect(out.startsWith('<p>')).toBe(true);
      expect(out.endsWith('</p>')).toBe(true);
    });
  });
});
