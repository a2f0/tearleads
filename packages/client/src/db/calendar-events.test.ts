import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from './adapters';
import { createCalendarEvent, getCalendarEvents } from './calendar-events';

const mockAdapter: Pick<DatabaseAdapter, 'execute'> = {
  execute: vi.fn()
};

const mockIsDatabaseInitialized = vi.fn();
const mockGetDatabaseAdapter = vi.fn();

vi.mock('./index', () => ({
  isDatabaseInitialized: () => mockIsDatabaseInitialized(),
  getDatabaseAdapter: () => mockGetDatabaseAdapter()
}));

describe('calendar-events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDatabaseInitialized.mockReturnValue(true);
    mockGetDatabaseAdapter.mockReturnValue(mockAdapter);
  });

  describe('getCalendarEvents', () => {
    it('returns empty array when database is not initialized', async () => {
      mockIsDatabaseInitialized.mockReturnValue(false);
      const events = await getCalendarEvents();
      expect(events).toEqual([]);
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('maps rows into calendar events', async () => {
      const now = Date.now();
      vi.mocked(mockAdapter.execute).mockResolvedValueOnce({
        rows: [
          {
            id: 'event-1',
            calendarName: 'Personal',
            title: 'Demo',
            startAt: now,
            endAt: now + 60 * 60 * 1000,
            createdAt: now,
            updatedAt: now
          }
        ]
      });

      const events = await getCalendarEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        id: 'event-1',
        calendarName: 'Personal',
        title: 'Demo',
        startAt: new Date(now),
        endAt: new Date(now + 60 * 60 * 1000),
        createdAt: new Date(now),
        updatedAt: new Date(now)
      });
    });
  });

  describe('createCalendarEvent', () => {
    it('returns null when input is invalid', async () => {
      const result = await createCalendarEvent({
        calendarName: 'Personal',
        title: '   ',
        startAt: new Date()
      });

      expect(result).toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('inserts and returns created event', async () => {
      vi.mocked(mockAdapter.execute).mockResolvedValueOnce({ rows: [] });

      const startAt = new Date('2026-02-09T10:00:00.000Z');
      const endAt = new Date('2026-02-09T11:00:00.000Z');
      const result = await createCalendarEvent({
        calendarName: 'Personal',
        title: 'Standup',
        startAt,
        endAt
      });

      expect(result).not.toBeNull();
      expect(result?.calendarName).toBe('Personal');
      expect(result?.title).toBe('Standup');
      expect(result?.startAt.getTime()).toBe(startAt.getTime());
      expect(result?.endAt?.getTime()).toBe(endAt.getTime());
      expect(mockAdapter.execute).toHaveBeenCalledTimes(1);
    });
  });
});
