// src/parsers/aiParser.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AiParser } from './aiParser.js';

// Create a mock create function that we can control
const mockCreate = vi.fn();

// Mock OpenAI module
vi.mock('openai', () => {
  return {
    OpenAI: vi.fn(function (this: any) {
      this.chat = {
        completions: {
          create: mockCreate,
        },
      };
    }),
  };
});

describe('AiParser', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up test environment
    process.env.AI_PROVIDER = 'openai';
    process.env.AI_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('initialization', () => {
    it('should initialize with OpenAI provider', () => {
      const parser = new AiParser();
      expect(parser).toBeInstanceOf(AiParser);
    });

    it('should throw error if AI_API_KEY is missing', () => {
      delete process.env.AI_API_KEY;
      expect(() => new AiParser()).toThrow('AI_API_KEY environment variable is required');
    });

    it('should throw for unimplemented provider', async () => {
      process.env.AI_PROVIDER = 'anthropic';
      const parser = new AiParser();
      await expect(parser.parse('test')).rejects.toThrow("Provider 'anthropic' not implemented");
    });
  });

  describe('parse()', () => {
    it('should extract semantics from unstructured content', async () => {
      const mockResponse = {
        importance: 'high',
        urgency: 'immediate',
        actions: [
          { description: 'Attend meeting', dueDate: '2026-01-07T10:00:00Z' },
        ],
        dates: [
          { event: 'Project deadline', start: '2026-01-10T17:00:00Z', timezone: 'PST' },
        ],
      };

      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify(mockResponse),
            },
          },
        ],
      });

      const parser = new AiParser();
      const result = await parser.parse(
        'Urgent meeting tomorrow at 10am PST about project deadline next Friday.'
      );

      expect(result).toBeTruthy();
      expect(result?.importance).toBe('high');
      expect(result?.urgency).toBe('immediate');
      expect(result?.actions).toHaveLength(1);
      expect(result?.actions[0]?.description).toBe('Attend meeting');
      expect(result?.actions[0]?.dueDate).toBeInstanceOf(Date);
      expect(result?.dates).toHaveLength(1);
      expect(result?.dates[0]?.start).toBeInstanceOf(Date);
    });

    it('should handle emails with no actions or dates', async () => {
      const mockResponse = {
        importance: 'low',
        urgency: 'long-term',
        actions: [],
        dates: [],
      };

      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify(mockResponse),
            },
          },
        ],
      });

      const parser = new AiParser();
      const result = await parser.parse('Just wanted to say hi and check in.');

      expect(result).toBeTruthy();
      expect(result?.importance).toBe('low');
      expect(result?.actions).toHaveLength(0);
      expect(result?.dates).toHaveLength(0);
    });

    it('should return null on invalid JSON response', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'This is not valid JSON',
            },
          },
        ],
      });

      const parser = new AiParser();
      const result = await parser.parse('test content');

      expect(result).toBeNull();
    });

    it('should return null on empty response', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: '',
            },
          },
        ],
      });

      const parser = new AiParser();
      const result = await parser.parse('test content');

      expect(result).toBeNull();
    });

    it('should return null when Zod validation fails', async () => {
      const invalidResponse = {
        importance: 'invalid-level', // Invalid enum value
        urgency: 'immediate',
        actions: [],
        dates: [],
      };

      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify(invalidResponse),
            },
          },
        ],
      });

      const parser = new AiParser();
      const result = await parser.parse('test content');

      expect(result).toBeNull();
    });

    it('should handle API errors gracefully', async () => {
      mockCreate.mockRejectedValue(new Error('API rate limit exceeded'));

      const parser = new AiParser();
      const result = await parser.parse('test content');

      expect(result).toBeNull();
    });

    it('should parse dates correctly', async () => {
      const mockResponse = {
        importance: 'medium',
        urgency: 'short-term',
        actions: [
          { description: 'Review document', dueDate: '2026-01-15T14:30:00Z' },
        ],
        dates: [
          {
            event: 'Conference',
            start: '2026-01-20T09:00:00Z',
            end: '2026-01-20T17:00:00Z',
            timezone: 'EST',
          },
        ],
      };

      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify(mockResponse),
            },
          },
        ],
      });

      const parser = new AiParser();
      const result = await parser.parse('Conference on Jan 20th from 9am to 5pm EST');

      expect(result).toBeTruthy();
      expect(result?.dates[0]?.start).toBeInstanceOf(Date);
      expect(result?.dates[0]?.end).toBeInstanceOf(Date);
      expect(result?.dates[0]?.timezone).toBe('EST');
    });

    it('should use correct OpenAI parameters', async () => {
      const mockResponse = {
        importance: 'medium',
        urgency: 'short-term',
        actions: [],
        dates: [],
      };

      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify(mockResponse),
            },
          },
        ],
      });

      const parser = new AiParser();
      await parser.parse('test email');

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'gpt-3.5-turbo',
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('test email'),
          }),
        ]),
        max_tokens: 500,
        temperature: 0.2,
      });
    });
  });
});
