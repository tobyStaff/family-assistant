// src/parsers/nlpParser.test.ts
import { describe, it, expect } from 'vitest';
import { NlpParser } from './nlpParser.js';
import { hasCommandKeywords } from './parserRouter.js';

describe('NlpParser', () => {
  const parser = new NlpParser();

  describe('command parsing', () => {
    it('parses todo with relative date', () => {
      const result = parser.parse('Subject: #todo Buy milk tomorrow at 3pm');
      expect(result).toBeTruthy();
      expect(result?.type).toBe('todo');
      expect(result?.description).toBe('Buy milk tomorrow at 3pm');
      expect(result?.dueDate).toBeInstanceOf(Date);
    });

    it('parses task with "next Tuesday" date', () => {
      const result = parser.parse('#task Meeting next Tuesday');
      expect(result).toBeTruthy();
      expect(result?.type).toBe('task');
      expect(result?.description).toContain('Meeting next Tuesday');
      expect(result?.dueDate).toBeInstanceOf(Date);
    });

    it('parses calendar event with specific date', () => {
      const result = parser.parse('#cal Team standup on January 10th at 10am');
      expect(result).toBeTruthy();
      expect(result?.type).toBe('cal');
      expect(result?.description).toContain('Team standup');
      expect(result?.dueDate).toBeInstanceOf(Date);
    });

    it('parses command without date', () => {
      const result = parser.parse('#todo Call the dentist');
      expect(result).toBeTruthy();
      expect(result?.type).toBe('todo');
      expect(result?.description).toBe('Call the dentist');
      expect(result?.dueDate).toBeUndefined();
    });

    it('handles "in 2 days" format', () => {
      const result = parser.parse('#task Review PR in 2 days');
      expect(result).toBeTruthy();
      expect(result?.dueDate).toBeInstanceOf(Date);
    });

    it('handles ISO date format', () => {
      const result = parser.parse('#cal Conference on 2026-01-15');
      expect(result).toBeTruthy();
      expect(result?.dueDate).toBeInstanceOf(Date);
    });
  });

  describe('keyword matching', () => {
    it('ignores non-command emails', () => {
      expect(parser.parse('Just a regular email')).toBeNull();
    });

    it('matches case-insensitively', () => {
      const result = parser.parse('#TODO Buy groceries');
      expect(result).toBeTruthy();
      expect(result?.type).toBe('todo');
    });

    it('matches alternative todo keywords', () => {
      const result1 = parser.parse('#to-do Buy groceries');
      expect(result1?.type).toBe('todo');

      const result2 = parser.parse('#addtodo Buy groceries');
      expect(result2?.type).toBe('todo');
    });

    it('matches alternative task keywords', () => {
      const result = parser.parse('#addtask Review code');
      expect(result?.type).toBe('task');
    });

    it('matches alternative calendar keywords', () => {
      const result1 = parser.parse('#event Team meeting');
      expect(result1?.type).toBe('cal');

      const result2 = parser.parse('#addevent Team meeting');
      expect(result2?.type).toBe('cal');
    });
  });

  describe('custom keywords', () => {
    it('handles custom keywords', () => {
      const customParser = new NlpParser({ todo: ['!todo'] });
      const result = customParser.parse('!todo Meeting next Tuesday');
      expect(result).toBeTruthy();
      expect(result?.type).toBe('todo');
    });

    it('merges custom keywords with defaults', () => {
      const customParser = new NlpParser({ todo: ['!urgent'] });
      const result = customParser.parse('!urgent Fix bug');
      expect(result).toBeTruthy();
      expect(result?.type).toBe('todo');
    });
  });

  describe('validation', () => {
    it('validates keywords with Zod', () => {
      expect(() => new NlpParser({ todo: [] })).toThrow();
    });

    it('rejects invalid keyword config', () => {
      expect(() => new NlpParser({ invalid: ['test'] } as never)).toThrow();
    });
  });

  describe('edge cases', () => {
    it('handles empty description', () => {
      const result = parser.parse('#todo');
      expect(result).toBeTruthy();
      expect(result?.description).toBe('');
    });

    it('handles multiple keywords (takes first match)', () => {
      const result = parser.parse('#todo #task Do something');
      expect(result).toBeTruthy();
      expect(result?.type).toBe('todo'); // First match wins
    });

    it('extracts description after keyword correctly', () => {
      const result = parser.parse('Email subject #todo Buy milk and eggs');
      expect(result).toBeTruthy();
      expect(result?.description).toBe('Buy milk and eggs');
    });
  });
});

describe('hasCommandKeywords', () => {
  it('detects command keywords', () => {
    expect(hasCommandKeywords('#todo Buy milk')).toBe(true);
    expect(hasCommandKeywords('#task Review code')).toBe(true);
    expect(hasCommandKeywords('#cal Meeting tomorrow')).toBe(true);
  });

  it('returns false for non-command emails', () => {
    expect(hasCommandKeywords('Regular email content')).toBe(false);
  });

  it('works case-insensitively', () => {
    expect(hasCommandKeywords('#TODO Buy milk')).toBe(true);
    expect(hasCommandKeywords('#TASK Review code')).toBe(true);
  });

  it('accepts custom keywords', () => {
    const customKeywords = {
      todo: ['!urgent'],
      task: ['#task'],
      cal: ['#cal'],
    };
    expect(hasCommandKeywords('!urgent Fix bug', customKeywords)).toBe(true);
    expect(hasCommandKeywords('#todo Fix bug', customKeywords)).toBe(false);
  });
});
