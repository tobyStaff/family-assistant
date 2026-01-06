// src/utils/attachmentSaver.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { saveAttachmentToDrive, getEmailAttachments } from './attachmentSaver.js';
import { PassThrough } from 'stream';
import type { OAuth2Client } from 'google-auth-library';

// Mock googleapis
const mockGmailGet = vi.fn();
const mockDriveCreate = vi.fn();
const mockMessagesGet = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    gmail: vi.fn(() => ({
      users: {
        messages: {
          attachments: {
            get: mockGmailGet,
          },
          get: mockMessagesGet,
        },
      },
    })),
    drive: vi.fn(() => ({
      files: {
        create: mockDriveCreate,
      },
    })),
  },
}));

describe('attachmentSaver', () => {
  const mockAuth = {} as OAuth2Client;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('saveAttachmentToDrive', () => {
    it('should save attachment successfully using streams', async () => {
      // Create a mock stream
      const mockStream = new PassThrough();
      mockStream.end('test file content');

      // Mock Gmail API response
      mockGmailGet.mockResolvedValue({
        data: mockStream,
      });

      // Mock Drive API response
      mockDriveCreate.mockResolvedValue({
        data: { id: 'drive-file-123' },
      });

      const result = await saveAttachmentToDrive(mockAuth, {
        emailId: 'email-123',
        attachmentId: 'att-456',
        fileName: 'test.pdf',
      });

      expect(result).toBe('drive-file-123');
      expect(mockGmailGet).toHaveBeenCalledWith({
        userId: 'me',
        messageId: 'email-123',
        id: 'att-456',
        alt: 'media',
      });
      expect(mockDriveCreate).toHaveBeenCalled();
    });

    it('should return null when no attachment data', async () => {
      mockGmailGet.mockResolvedValue({
        data: null,
      });

      const result = await saveAttachmentToDrive(mockAuth, {
        emailId: 'email-123',
        attachmentId: 'att-456',
        fileName: 'test.pdf',
      });

      expect(result).toBeNull();
    });

    it('should return null when Drive API fails', async () => {
      const mockStream = new PassThrough();
      mockStream.end('test content');

      mockGmailGet.mockResolvedValue({
        data: mockStream,
      });

      mockDriveCreate.mockRejectedValue(new Error('Drive API error'));

      const result = await saveAttachmentToDrive(mockAuth, {
        emailId: 'email-123',
        attachmentId: 'att-456',
        fileName: 'test.pdf',
      });

      expect(result).toBeNull();
    });

    it('should return null when Drive does not return file ID', async () => {
      const mockStream = new PassThrough();
      mockStream.end('test content');

      mockGmailGet.mockResolvedValue({
        data: mockStream,
      });

      mockDriveCreate.mockResolvedValue({
        data: {}, // No id field
      });

      const result = await saveAttachmentToDrive(mockAuth, {
        emailId: 'email-123',
        attachmentId: 'att-456',
        fileName: 'test.pdf',
      });

      expect(result).toBeNull();
    });

    it('should handle Gmail API errors', async () => {
      mockGmailGet.mockRejectedValue(new Error('Gmail API error'));

      const result = await saveAttachmentToDrive(mockAuth, {
        emailId: 'email-123',
        attachmentId: 'att-456',
        fileName: 'test.pdf',
      });

      expect(result).toBeNull();
    });

    it('should use correct parameters for Drive upload', async () => {
      const mockStream = new PassThrough();
      mockStream.end('test content');

      mockGmailGet.mockResolvedValue({
        data: mockStream,
      });

      mockDriveCreate.mockResolvedValue({
        data: { id: 'file-123' },
      });

      await saveAttachmentToDrive(mockAuth, {
        emailId: 'email-123',
        attachmentId: 'att-456',
        fileName: 'important-document.pdf',
      });

      expect(mockDriveCreate).toHaveBeenCalledWith({
        requestBody: {
          name: 'important-document.pdf',
        },
        media: {
          mimeType: 'application/octet-stream',
          body: expect.any(PassThrough),
        },
        fields: 'id',
      });
    });
  });

  describe('getEmailAttachments', () => {
    it('should list attachments from email', async () => {
      mockMessagesGet.mockResolvedValue({
        data: {
          payload: {
            parts: [
              {
                filename: 'document.pdf',
                body: {
                  attachmentId: 'att-1',
                  size: 12345,
                },
              },
              {
                filename: 'image.jpg',
                body: {
                  attachmentId: 'att-2',
                  size: 67890,
                },
              },
            ],
          },
        },
      });

      const result = await getEmailAttachments(mockAuth, 'email-123');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'att-1',
        filename: 'document.pdf',
        size: 12345,
      });
      expect(result[1]).toEqual({
        id: 'att-2',
        filename: 'image.jpg',
        size: 67890,
      });
    });

    it('should handle nested parts (multipart messages)', async () => {
      mockMessagesGet.mockResolvedValue({
        data: {
          payload: {
            parts: [
              {
                mimeType: 'multipart/mixed',
                parts: [
                  {
                    filename: 'nested.pdf',
                    body: {
                      attachmentId: 'att-nested',
                      size: 54321,
                    },
                  },
                ],
              },
            ],
          },
        },
      });

      const result = await getEmailAttachments(mockAuth, 'email-123');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'att-nested',
        filename: 'nested.pdf',
        size: 54321,
      });
    });

    it('should return empty array when no attachments', async () => {
      mockMessagesGet.mockResolvedValue({
        data: {
          payload: {
            parts: [],
          },
        },
      });

      const result = await getEmailAttachments(mockAuth, 'email-123');

      expect(result).toEqual([]);
    });

    it('should return empty array on API error', async () => {
      mockMessagesGet.mockRejectedValue(new Error('Gmail API error'));

      const result = await getEmailAttachments(mockAuth, 'email-123');

      expect(result).toEqual([]);
    });

    it('should handle missing size field', async () => {
      mockMessagesGet.mockResolvedValue({
        data: {
          payload: {
            parts: [
              {
                filename: 'file.txt',
                body: {
                  attachmentId: 'att-1',
                  // size is missing
                },
              },
            ],
          },
        },
      });

      const result = await getEmailAttachments(mockAuth, 'email-123');

      expect(result).toHaveLength(1);
      expect(result[0]?.size).toBe(0);
    });
  });
});
