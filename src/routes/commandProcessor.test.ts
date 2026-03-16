// src/routes/commandProcessor.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { register } from 'prom-client';

// Mock the database with in-memory instance
vi.mock('../db/db.js', async () => {
  const { createTestDb } = await import('../tests/createTestDb.js');
  return { default: createTestDb() };
});

// Mock googleapis
vi.mock('googleapis', () => ({
  google: {
    gmail: vi.fn(() => ({
      users: {
        messages: {
          get: vi.fn(),
          attachments: {
            get: vi.fn(),
          },
        },
      },
    })),
    calendar: vi.fn(() => ({
      events: {
        insert: vi.fn(),
        list: vi.fn(() => ({
          data: { items: [] },
        })),
      },
    })),
    drive: vi.fn(() => ({
      files: {
        create: vi.fn(() => ({
          data: { id: 'drive-file-123' },
        })),
      },
    })),
  },
}));

// Mock OpenAI
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
    })),
  };
});

describe('commandProcessor', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();

    // Clear Prometheus registry to avoid "already registered" errors
    register.clear();

    // Build fresh app for each test
    app = await buildApp();

    // Clean database tables
    const db = (await import('../db/db.js')).default as Database.Database;
    db.exec('DELETE FROM todos');
    db.exec('DELETE FROM processed_emails');
  });

  describe('POST /process-command/:emailId', () => {
    it('should return 401 for unauthenticated request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/process-command/test-email-123',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 401 when no session is present', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/process-command/test-email-123',
      });

      expect(response.statusCode).toBe(401);
    });

    // Note: The following tests would require mocking the auth functions
    // Since getUserId and getUserAuth throw errors, we can't test the full flow
    // without implementing actual auth. These are placeholder tests for when auth is ready.

    it.todo('should process email idempotently', async () => {
      // TODO: Mock getUserId and getUserAuth
      // Process same email twice, verify second returns "Already processed"
    });

    it.todo('should route to NLP parser for command keywords', async () => {
      // TODO: Mock email with #todo keyword
      // Verify NLP parser is used and TODO is created
    });

    it.todo('should route to AI parser for semantic content', async () => {
      // TODO: Mock email without keywords
      // Verify AI parser is used and actions are created
    });

    it.todo('should save attachments to Drive', async () => {
      // TODO: Mock email with attachments
      // Verify saveAttachmentToDrive is called for each attachment
    });

    it.todo('should create TODOs from parsed commands', async () => {
      // TODO: Mock parsed command with type='todo'
      // Verify createTodo is called with correct params
    });

    it.todo('should add calendar events from parsed commands', async () => {
      // TODO: Mock parsed command with type='cal'
      // Verify calendar.events.insert is called
    });

    it.todo('should handle parse failures gracefully', async () => {
      // TODO: Mock routeParse to return null
      // Verify 400 response with appropriate error message
    });

    it.todo('should handle Gmail API errors gracefully', async () => {
      // TODO: Mock gmail.users.messages.get to throw error
      // Verify 500 response with error handling
    });
  });
});

describe('processedDb', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = (await import('../db/db.js')).default as Database.Database;
    db.exec('DELETE FROM processed_emails');
  });

  it('should check if email is processed', async () => {
    const { isProcessed, markProcessed } = await import('../db/processedDb.js');

    expect(isProcessed('user1', 'email123')).toBe(false);

    markProcessed('user1', 'email123');

    expect(isProcessed('user1', 'email123')).toBe(true);
  });

  it('should mark email as processed', async () => {
    const { markProcessed, listProcessed } = await import('../db/processedDb.js');

    markProcessed('user1', 'email123');
    markProcessed('user1', 'email456');

    const processed = listProcessed('user1');
    expect(processed).toHaveLength(2);
    expect(processed[0]?.email_id).toBe('email456'); // Newest first
    expect(processed[1]?.email_id).toBe('email123');
  });

  it('should isolate processed emails by user', async () => {
    const { markProcessed, isProcessed } = await import('../db/processedDb.js');

    markProcessed('user1', 'email123');

    expect(isProcessed('user1', 'email123')).toBe(true);
    expect(isProcessed('user2', 'email123')).toBe(false); // Different user
  });
});

describe('emailExtractor', () => {
  it('should extract plain text from simple email', async () => {
    const { getEmailContent } = await import('../utils/emailExtractor.js');

    const mockMessage = {
      payload: {
        body: {
          data: Buffer.from('Hello World').toString('base64'),
        },
      },
    };

    const content = getEmailContent(mockMessage as any);
    expect(content).toBe('Hello World');
  });

  it('should extract text from multipart email', async () => {
    const { getEmailContent } = await import('../utils/emailExtractor.js');

    const mockMessage = {
      payload: {
        parts: [
          {
            mimeType: 'text/plain',
            body: {
              data: Buffer.from('Plain text content').toString('base64'),
            },
          },
        ],
      },
    };

    const content = getEmailContent(mockMessage as any);
    expect(content).toBe('Plain text content');
  });

  it('should extract attachments from email', async () => {
    const { getAttachments } = await import('../utils/emailExtractor.js');

    const mockMessage = {
      payload: {
        parts: [
          {
            filename: 'document.pdf',
            mimeType: 'application/pdf',
            body: {
              attachmentId: 'att123',
              size: 1024,
            },
          },
        ],
      },
    };

    const attachments = getAttachments(mockMessage as any);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toEqual({
      id: 'att123',
      filename: 'document.pdf',
      mimeType: 'application/pdf',
      size: 1024,
    });
  });

  it('should return empty array when no attachments', async () => {
    const { getAttachments } = await import('../utils/emailExtractor.js');

    const mockMessage = {
      payload: {
        parts: [
          {
            mimeType: 'text/plain',
            body: {
              data: 'test',
            },
          },
        ],
      },
    };

    const attachments = getAttachments(mockMessage as any);
    expect(attachments).toEqual([]);
  });
});

describe('parserRouter', () => {
  it('should route to NLP parser when keywords present', async () => {
    const { routeParse } = await import('../parsers/parserRouter.js');

    const content = '#todo Buy groceries tomorrow';
    const result = await routeParse(content);

    expect(result).toBeDefined();
    expect('type' in result!).toBe(true);
  });

  it.skip('should route to AI parser when no keywords', async () => {
    // Skip this test for now - requires complex OpenAI mocking
    // TODO: Implement proper OpenAI mocking for AI parser test
    // The AI parser requires:
    // 1. AI_API_KEY environment variable
    // 2. Proper OpenAI mock that returns JSON response
    // 3. Coordination with the global vi.mock setup
  });
});
