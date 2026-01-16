// src/utils/summaryQueries.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// Mock the database
vi.mock('../db/db.js', () => {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');

  testDb.exec(`
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      description TEXT NOT NULL,
      due_date DATETIME,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'done')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return { default: testDb };
});

// Mock googleapis
vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      events: {
        list: vi.fn(),
      },
    })),
  },
}));

import { getUpcomingTodos, getUpcomingEvents, generateSummary } from './summaryQueries.js';
import { createTodo } from '../db/todoDb.js';
import db from '../db/db.js';
import { addHours } from 'date-fns';

const testDb = db as Database.Database;

describe('summaryQueries', () => {
  beforeEach(() => {
    testDb.exec('DELETE FROM todos');
  });

  describe('getUpcomingTodos', () => {
    it('should return TODOs due in next 24 hours', () => {
      const tomorrow = addHours(new Date(), 12);
      const nextWeek = addHours(new Date(), 7 * 24);

      // Create TODOs
      createTodo('user1', 'Due tomorrow', tomorrow, 'pending');
      createTodo('user1', 'Due next week', nextWeek, 'pending');
      createTodo('user1', 'No due date'); // No due date

      const upcoming = getUpcomingTodos('user1');

      // Should only return tomorrow's TODO
      expect(upcoming).toHaveLength(1);
      expect(upcoming[0]?.description).toBe('Due tomorrow');
      expect(upcoming[0]?.dueDate).toBeInstanceOf(Date);
    });

    it('should not return completed TODOs', () => {
      const tomorrow = addHours(new Date(), 12);

      createTodo('user1', 'Pending task', tomorrow, 'pending');
      createTodo('user1', 'Done task', tomorrow, 'done');

      const upcoming = getUpcomingTodos('user1');

      expect(upcoming).toHaveLength(1);
      expect(upcoming[0]?.description).toBe('Pending task');
    });

    it('should return empty array if no upcoming TODOs', () => {
      const nextWeek = addHours(new Date(), 7 * 24);
      createTodo('user1', 'Far future', nextWeek, 'pending');

      const upcoming = getUpcomingTodos('user1');

      expect(upcoming).toEqual([]);
    });

    it('should isolate TODOs by user', () => {
      const tomorrow = addHours(new Date(), 12);

      createTodo('user1', 'User 1 task', tomorrow, 'pending');
      createTodo('user2', 'User 2 task', tomorrow, 'pending');

      const user1Upcoming = getUpcomingTodos('user1');
      const user2Upcoming = getUpcomingTodos('user2');

      expect(user1Upcoming).toHaveLength(1);
      expect(user1Upcoming[0]?.description).toBe('User 1 task');

      expect(user2Upcoming).toHaveLength(1);
      expect(user2Upcoming[0]?.description).toBe('User 2 task');
    });
  });

  describe('getUpcomingEvents', () => {
    it('should fetch events from Google Calendar', async () => {
      const { google } = await import('googleapis');
      const mockList = vi.fn().mockResolvedValue({
        data: {
          items: [
            {
              summary: 'Meeting',
              start: { dateTime: new Date().toISOString() },
              end: { dateTime: addHours(new Date(), 1).toISOString() },
            },
          ],
        },
      });

      (google.calendar as any).mockReturnValue({
        events: { list: mockList },
      });

      const mockAuth = {} as any;
      const events = await getUpcomingEvents(mockAuth);

      expect(events).toHaveLength(1);
      expect(events[0]?.summary).toBe('Meeting');
      expect(events[0]?.start).toBeInstanceOf(Date);
      expect(events[0]?.end).toBeInstanceOf(Date);
    });

    it('should handle events without titles', async () => {
      const { google } = await import('googleapis');
      const mockList = vi.fn().mockResolvedValue({
        data: {
          items: [
            {
              summary: null,
              start: { dateTime: new Date().toISOString() },
            },
          ],
        },
      });

      (google.calendar as any).mockReturnValue({
        events: { list: mockList },
      });

      const mockAuth = {} as any;
      const events = await getUpcomingEvents(mockAuth);

      expect(events).toHaveLength(1);
      expect(events[0]?.summary).toBe('(No title)');
    });

    it('should return empty array on Calendar API error', async () => {
      const { google } = await import('googleapis');
      const mockList = vi.fn().mockRejectedValue(new Error('Calendar API error'));

      (google.calendar as any).mockReturnValue({
        events: { list: mockList },
      });

      const mockAuth = {} as any;
      const events = await getUpcomingEvents(mockAuth);

      expect(events).toEqual([]);
    });
  });

  describe('generateSummary', () => {
    it('should combine TODOs and events', async () => {
      const tomorrow = addHours(new Date(), 12);
      createTodo('user1', 'Task 1', tomorrow, 'pending');

      const { google } = await import('googleapis');
      const mockList = vi.fn().mockResolvedValue({
        data: {
          items: [
            {
              summary: 'Event 1',
              start: { dateTime: new Date().toISOString() },
            },
          ],
        },
      });

      (google.calendar as any).mockReturnValue({
        events: { list: mockList },
      });

      const mockAuth = {} as any;
      const summary = await generateSummary('user1', mockAuth);

      expect(summary.todos).toHaveLength(1);
      expect(summary.todos[0]?.description).toBe('Task 1');

      expect(summary.events).toHaveLength(1);
      expect(summary.events[0]?.summary).toBe('Event 1');
    });

    it('should handle empty summary', async () => {
      const { google } = await import('googleapis');
      const mockList = vi.fn().mockResolvedValue({
        data: { items: [] },
      });

      (google.calendar as any).mockReturnValue({
        events: { list: mockList },
      });

      const mockAuth = {} as any;
      const summary = await generateSummary('user1', mockAuth);

      expect(summary.todos).toEqual([]);
      expect(summary.events).toEqual([]);
    });
  });
});
