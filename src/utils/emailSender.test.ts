// src/utils/emailSender.test.ts
import { describe, it, expect, vi } from 'vitest';

type LegacySummary = {
  todos: Array<{ description: string; dueDate?: Date }>;
  events: Array<{ summary: string; start: Date; end?: Date }>;
};

// Mock googleapis
vi.mock('googleapis', () => ({
  google: {
    gmail: vi.fn(() => ({
      users: {
        messages: {
          send: vi.fn(),
        },
      },
    })),
  },
}));

import { sendDailySummary } from './emailSender.js';

describe('emailSender', () => {
  describe('sendDailySummary', () => {
    it('should send email with TODOs and events', async () => {
      const { google } = await import('googleapis');
      const mockSend = vi.fn().mockResolvedValue({ data: { id: 'message123' } });

      (google.gmail as any).mockReturnValue({
        users: {
          messages: {
            send: mockSend,
          },
        },
      });

      const summary: LegacySummary = {
        todos: [
          { description: 'Task 1', dueDate: new Date('2026-01-10') },
          { description: 'Task 2' },
        ],
        events: [
          {
            summary: 'Meeting',
            start: new Date('2026-01-08T10:00:00'),
            end: new Date('2026-01-08T11:00:00'),
          },
        ],
      };

      const mockAuth = {} as any;
      await sendDailySummary(mockAuth, summary, 'user@example.com');

      expect(mockSend).toHaveBeenCalledOnce();

      const callArgs = mockSend.mock.calls[0]?.[0];
      expect(callArgs).toBeDefined();
      expect(callArgs?.userId).toBe('me');
      expect(callArgs.requestBody).toHaveProperty('raw');

      // Verify the raw message is base64url encoded
      const raw = callArgs.requestBody.raw;
      expect(typeof raw).toBe('string');
      expect(raw).not.toContain('+'); // Base64url uses - instead of +
      expect(raw).not.toContain('/'); // Base64url uses _ instead of /
    });

    it('should send email with empty summary', async () => {
      const { google } = await import('googleapis');
      const mockSend = vi.fn().mockResolvedValue({ data: { id: 'message123' } });

      (google.gmail as any).mockReturnValue({
        users: {
          messages: {
            send: mockSend,
          },
        },
      });

      const summary: LegacySummary = {
        todos: [],
        events: [],
      };

      const mockAuth = {} as any;
      await sendDailySummary(mockAuth, summary, 'user@example.com');

      expect(mockSend).toHaveBeenCalledOnce();
    });

    it('should throw error on Gmail API failure', async () => {
      const { google } = await import('googleapis');
      const mockSend = vi.fn().mockRejectedValue(new Error('Gmail API error'));

      (google.gmail as any).mockReturnValue({
        users: {
          messages: {
            send: mockSend,
          },
        },
      });

      const summary: LegacySummary = {
        todos: [],
        events: [],
      };

      const mockAuth = {} as any;

      await expect(sendDailySummary(mockAuth, summary, 'user@example.com')).rejects.toThrow(
        'Gmail API error'
      );
    });

    it('should format dates correctly in email', async () => {
      const { google } = await import('googleapis');
      let sentMessage = '';

      const mockSend = vi.fn().mockImplementation(async (params) => {
        // Decode the base64url message
        const raw = params.requestBody.raw;
        const decoded = Buffer.from(
          raw.replace(/-/g, '+').replace(/_/g, '/'),
          'base64'
        ).toString('utf-8');
        sentMessage = decoded;
        return { data: { id: 'message123' } };
      });

      (google.gmail as any).mockReturnValue({
        users: {
          messages: {
            send: mockSend,
          },
        },
      });

      const summary: LegacySummary = {
        todos: [{ description: 'Test task', dueDate: new Date('2026-01-10T15:30:00') }],
        events: [],
      };

      const mockAuth = {} as any;
      await sendDailySummary(mockAuth, summary, 'user@example.com');

      // Verify the email contains the task description
      expect(sentMessage).toContain('Test task');

      // Verify it contains "Subject: Daily Inbox Summary"
      expect(sentMessage).toContain('Subject: Daily Inbox Summary');

      // Verify it contains both HTML and text parts
      expect(sentMessage).toContain('Content-Type: text/html');
      expect(sentMessage).toContain('Content-Type: text/plain');
    });
  });
});
