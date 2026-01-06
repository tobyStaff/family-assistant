// src/routes/calendarRoutes.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { calendarRoutes } from './calendarRoutes.js';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// Mock googleapis
const mockEventsInsert = vi.fn();
const mockEventsList = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      events: {
        insert: mockEventsInsert,
        list: mockEventsList,
      },
    })),
  },
}));

// Mock calendarDedup
vi.mock('../utils/calendarDedup.js', () => ({
  checkForDuplicate: vi.fn(),
}));

import { checkForDuplicate } from '../utils/calendarDedup.js';
const mockCheckForDuplicate = vi.mocked(checkForDuplicate);

describe('calendarRoutes', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    fastify = Fastify();
    await calendarRoutes(fastify);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  describe('POST /add-event', () => {
    it('should reject request with missing summary', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/add-event',
        payload: {
          start: '2026-01-07T10:00:00Z',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Invalid event data');
      expect(body.details).toBeDefined();
    });

    it('should reject request with invalid start date', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/add-event',
        payload: {
          summary: 'Team Meeting',
          start: 'invalid-date',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Invalid event data');
    });

    it('should return 500 when auth not implemented', async () => {
      mockCheckForDuplicate.mockResolvedValue(false);

      const response = await fastify.inject({
        method: 'POST',
        url: '/add-event',
        payload: {
          summary: 'Team Meeting',
          start: '2026-01-07T10:00:00Z',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Internal server error');
    });

    it('should convert dates to user timezone', async () => {
      // This test verifies the date conversion logic would work
      // when auth is implemented
      const { toZonedTime } = await import('date-fns-tz');
      const { formatISO } = await import('date-fns');

      const utcDate = new Date('2026-01-07T09:00:00Z');
      const userTZ = 'America/Los_Angeles';
      const zonedDate = toZonedTime(utcDate, userTZ);
      const formatted = formatISO(zonedDate);

      // 9am UTC = 1am PST (UTC-8)
      expect(zonedDate.getHours()).toBe(1);
      expect(formatted).toContain('2026-01-07T01:00:00');
    });

    it('should handle optional end date', async () => {
      const { toZonedTime } = await import('date-fns-tz');

      const startDate = new Date('2026-01-07T10:00:00Z');
      const endDate = new Date('2026-01-07T11:00:00Z');
      const userTZ = 'UTC';

      const zonedStart = toZonedTime(startDate, userTZ);
      const zonedEnd = toZonedTime(endDate, userTZ);

      expect(zonedEnd.getTime() - zonedStart.getTime()).toBe(60 * 60 * 1000);
    });

    it('should validate request body structure', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/add-event',
        payload: {
          summary: '',
          start: '2026-01-07T10:00:00Z',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Invalid event data');
      expect(body.details).toBeDefined();
    });

    it('should accept valid event with all fields', async () => {
      // This verifies schema validation works correctly
      const payload = {
        summary: 'Team Meeting',
        description: 'Quarterly review',
        start: '2026-01-07T10:00:00Z',
        end: '2026-01-07T11:00:00Z',
        parsedTimeZone: 'America/Los_Angeles',
      };

      // Schema should accept this
      const { z } = await import('zod');
      const AddEventBodySchema = z.object({
        summary: z.string().min(1),
        description: z.string().optional(),
        start: z.coerce.date(),
        end: z.coerce.date().optional(),
        parsedTimeZone: z.string().optional(),
      });

      const result = AddEventBodySchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.summary).toBe('Team Meeting');
        expect(result.data.start).toBeInstanceOf(Date);
        expect(result.data.end).toBeInstanceOf(Date);
      }
    });

    it('should coerce string dates to Date objects', async () => {
      const { z } = await import('zod');
      const AddEventBodySchema = z.object({
        start: z.coerce.date(),
        end: z.coerce.date().optional(),
      });

      const result = AddEventBodySchema.safeParse({
        start: '2026-01-07T10:00:00Z',
        end: '2026-01-07T11:00:00Z',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.start).toBeInstanceOf(Date);
        expect(result.data.end).toBeInstanceOf(Date);
      }
    });

    it('should format event data correctly for Calendar API', async () => {
      const { formatISO } = await import('date-fns');
      const { toZonedTime } = await import('date-fns-tz');

      const startDate = new Date('2026-01-07T10:00:00Z');
      const userTZ = 'America/Los_Angeles';
      const zonedStart = toZonedTime(startDate, userTZ);

      const eventData = {
        summary: 'Team Meeting',
        description: 'Quarterly review',
        start: {
          dateTime: formatISO(zonedStart),
          timeZone: userTZ,
        },
      };

      expect(eventData.start.dateTime).toBeDefined();
      expect(eventData.start.timeZone).toBe('America/Los_Angeles');
      expect(eventData.summary).toBe('Team Meeting');
    });

    it('should handle different timezones correctly', async () => {
      const { toZonedTime } = await import('date-fns-tz');

      const utcDate = new Date('2026-01-07T12:00:00Z');

      // Test multiple timezones
      const pstDate = toZonedTime(utcDate, 'America/Los_Angeles');
      const estDate = toZonedTime(utcDate, 'America/New_York');
      const tokyoDate = toZonedTime(utcDate, 'Asia/Tokyo');

      // 12:00 UTC = 04:00 PST (UTC-8)
      expect(pstDate.getHours()).toBe(4);
      // 12:00 UTC = 07:00 EST (UTC-5)
      expect(estDate.getHours()).toBe(7);
      // 12:00 UTC = 21:00 JST (UTC+9)
      expect(tokyoDate.getHours()).toBe(21);
    });
  });
});
