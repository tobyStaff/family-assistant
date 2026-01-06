// src/utils/calendarDedup.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkForDuplicate } from './calendarDedup.js';
import type { OAuth2Client } from 'google-auth-library';
import type { EventData } from '../types/calendar.js';

// Mock googleapis
const mockEventsList = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      events: {
        list: mockEventsList,
      },
    })),
  },
}));

describe('calendarDedup', () => {
  const mockAuth = {} as OAuth2Client;
  const userTimeZone = 'America/Los_Angeles';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkForDuplicate', () => {
    it('should return false when no events in calendar', async () => {
      mockEventsList.mockResolvedValue({
        data: { items: [] },
      });

      const eventData: EventData = {
        summary: 'Team Meeting',
        start: {
          dateTime: '2026-01-07T10:00:00-08:00',
          timeZone: userTimeZone,
        },
      };

      const result = await checkForDuplicate(
        mockAuth,
        'primary',
        eventData,
        userTimeZone
      );

      expect(result).toBe(false);
      expect(mockEventsList).toHaveBeenCalledWith({
        calendarId: 'primary',
        timeMin: expect.any(String),
        timeMax: expect.any(String),
        singleEvents: true,
        orderBy: 'startTime',
      });
    });

    it('should return true for exact duplicate (same summary and time)', async () => {
      mockEventsList.mockResolvedValue({
        data: {
          items: [
            {
              summary: 'Team Meeting',
              start: { dateTime: '2026-01-07T10:00:00-08:00' },
            },
          ],
        },
      });

      const eventData: EventData = {
        summary: 'Team Meeting',
        start: {
          dateTime: '2026-01-07T10:00:00-08:00',
          timeZone: userTimeZone,
        },
      };

      const result = await checkForDuplicate(
        mockAuth,
        'primary',
        eventData,
        userTimeZone
      );

      expect(result).toBe(true);
    });

    it('should return true for fuzzy match (high similarity)', async () => {
      mockEventsList.mockResolvedValue({
        data: {
          items: [
            {
              summary: 'Project Team Meeting',
              start: { dateTime: '2026-01-07T10:00:00-08:00' },
            },
          ],
        },
      });

      const eventData: EventData = {
        summary: 'Project Team Mtg',
        start: {
          dateTime: '2026-01-07T10:05:00-08:00', // 5 minutes apart
          timeZone: userTimeZone,
        },
      };

      const result = await checkForDuplicate(
        mockAuth,
        'primary',
        eventData,
        userTimeZone
      );

      expect(result).toBe(true);
    });

    it('should return false for low similarity match', async () => {
      mockEventsList.mockResolvedValue({
        data: {
          items: [
            {
              summary: 'Team Meeting',
              start: { dateTime: '2026-01-07T10:00:00-08:00' },
            },
          ],
        },
      });

      const eventData: EventData = {
        summary: 'Dentist Appointment',
        start: {
          dateTime: '2026-01-07T10:00:00-08:00',
          timeZone: userTimeZone,
        },
      };

      const result = await checkForDuplicate(
        mockAuth,
        'primary',
        eventData,
        userTimeZone
      );

      expect(result).toBe(false);
    });

    it('should return false when times differ by more than 1 hour', async () => {
      mockEventsList.mockResolvedValue({
        data: {
          items: [
            {
              summary: 'Team Meeting',
              start: { dateTime: '2026-01-07T10:00:00-08:00' },
            },
          ],
        },
      });

      const eventData: EventData = {
        summary: 'Team Meeting',
        start: {
          dateTime: '2026-01-07T12:00:00-08:00', // 2 hours apart
          timeZone: userTimeZone,
        },
      };

      const result = await checkForDuplicate(
        mockAuth,
        'primary',
        eventData,
        userTimeZone
      );

      expect(result).toBe(false);
    });

    it('should match with description similarity', async () => {
      mockEventsList.mockResolvedValue({
        data: {
          items: [
            {
              summary: 'Team Meeting',
              description: 'Discuss Q1 goals and objectives for the team',
              start: { dateTime: '2026-01-07T10:00:00-08:00' },
            },
          ],
        },
      });

      const eventData: EventData = {
        summary: 'Team Meeting',
        description: 'Discuss Q1 goals and objectives for team',
        start: {
          dateTime: '2026-01-07T10:00:00-08:00',
          timeZone: userTimeZone,
        },
      };

      const result = await checkForDuplicate(
        mockAuth,
        'primary',
        eventData,
        userTimeZone
      );

      expect(result).toBe(true);
    });

    it('should not match when descriptions differ significantly', async () => {
      mockEventsList.mockResolvedValue({
        data: {
          items: [
            {
              summary: 'Team Meeting',
              description: 'Discuss Q1 goals',
              start: { dateTime: '2026-01-07T10:00:00-08:00' },
            },
          ],
        },
      });

      const eventData: EventData = {
        summary: 'Team Meeting',
        description: 'Review annual budget',
        start: {
          dateTime: '2026-01-07T10:00:00-08:00',
          timeZone: userTimeZone,
        },
      };

      const result = await checkForDuplicate(
        mockAuth,
        'primary',
        eventData,
        userTimeZone
      );

      expect(result).toBe(false);
    });

    it('should handle events without descriptions', async () => {
      mockEventsList.mockResolvedValue({
        data: {
          items: [
            {
              summary: 'Team Meeting',
              start: { dateTime: '2026-01-07T10:00:00-08:00' },
            },
          ],
        },
      });

      const eventData: EventData = {
        summary: 'Team Meeting',
        start: {
          dateTime: '2026-01-07T10:00:00-08:00',
          timeZone: userTimeZone,
        },
      };

      const result = await checkForDuplicate(
        mockAuth,
        'primary',
        eventData,
        userTimeZone
      );

      expect(result).toBe(true);
    });

    it('should handle all-day events', async () => {
      mockEventsList.mockResolvedValue({
        data: {
          items: [
            {
              summary: 'Holiday',
              start: { dateTime: '2026-01-07T00:00:00-08:00' },
            },
          ],
        },
      });

      const eventData: EventData = {
        summary: 'Holiday',
        start: {
          dateTime: '2026-01-07T00:30:00-08:00', // Within 1 hour
          timeZone: userTimeZone,
        },
      };

      const result = await checkForDuplicate(
        mockAuth,
        'primary',
        eventData,
        userTimeZone
      );

      expect(result).toBe(true);
    });

    it('should return false on API error', async () => {
      mockEventsList.mockRejectedValue(new Error('Calendar API error'));

      const eventData: EventData = {
        summary: 'Team Meeting',
        start: {
          dateTime: '2026-01-07T10:00:00-08:00',
          timeZone: userTimeZone,
        },
      };

      const result = await checkForDuplicate(
        mockAuth,
        'primary',
        eventData,
        userTimeZone
      );

      // Should return false to avoid blocking event creation
      expect(result).toBe(false);
    });

    it('should query with correct time window (±1 day)', async () => {
      mockEventsList.mockResolvedValue({
        data: { items: [] },
      });

      const eventData: EventData = {
        summary: 'Team Meeting',
        start: {
          dateTime: '2026-01-07T10:00:00-08:00',
          timeZone: userTimeZone,
        },
      };

      await checkForDuplicate(mockAuth, 'primary', eventData, userTimeZone);

      const callArgs = mockEventsList.mock.calls[0]?.[0];
      expect(callArgs).toBeDefined();
      expect(callArgs?.timeMin).toBeDefined();
      expect(callArgs?.timeMax).toBeDefined();

      // Verify the time window is approximately ±1 day
      const timeMin = new Date(callArgs?.timeMin as string);
      const timeMax = new Date(callArgs?.timeMax as string);
      const eventTime = new Date(eventData.start.dateTime);

      const diffMin = Math.abs(eventTime.getTime() - timeMin.getTime());
      const diffMax = Math.abs(timeMax.getTime() - eventTime.getTime());

      // Should be close to 24 hours (allow some variance for timezone conversion)
      expect(diffMin).toBeGreaterThan(23 * 60 * 60 * 1000);
      expect(diffMin).toBeLessThan(25 * 60 * 60 * 1000);
      expect(diffMax).toBeGreaterThan(23 * 60 * 60 * 1000);
      expect(diffMax).toBeLessThan(25 * 60 * 60 * 1000);
    });

    it('should be case-insensitive for matching', async () => {
      mockEventsList.mockResolvedValue({
        data: {
          items: [
            {
              summary: 'TEAM MEETING',
              start: { dateTime: '2026-01-07T10:00:00-08:00' },
            },
          ],
        },
      });

      const eventData: EventData = {
        summary: 'team meeting',
        start: {
          dateTime: '2026-01-07T10:00:00-08:00',
          timeZone: userTimeZone,
        },
      };

      const result = await checkForDuplicate(
        mockAuth,
        'primary',
        eventData,
        userTimeZone
      );

      expect(result).toBe(true);
    });
  });
});
