import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from './adapters';
import {
  createCalendarEvent,
  getCalendarEvents,
  getContactBirthdayEvents
} from './calendar-events';

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
        updatedAt: new Date(now),
        recurrence: null,
        recurringEventId: null,
        originalStartAt: null
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

  describe('getContactBirthdayEvents', () => {
    it('returns empty array when database is not initialized', async () => {
      mockIsDatabaseInitialized.mockReturnValue(false);

      const events = await getContactBirthdayEvents(new Date('2026-02-09'));

      expect(events).toEqual([]);
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('maps contact birthdays into recurring calendar events', async () => {
      vi.mocked(mockAdapter.execute).mockResolvedValueOnce({
        rows: [
          {
            id: 'contact-1',
            firstName: 'Alex',
            lastName: 'Rivera',
            birthday: '1990-06-20'
          }
        ]
      });

      const events = await getContactBirthdayEvents(new Date('2026-01-01'));

      expect(events).toHaveLength(11);
      const eventForReferenceYear = events.find(
        (event) => event.id === 'birthday:contact-1:2026'
      );
      expect(eventForReferenceYear).toBeDefined();
      expect(eventForReferenceYear?.title).toBe("Alex Rivera's Birthday");
      expect(eventForReferenceYear?.calendarName).toBe('Personal');
      expect(eventForReferenceYear?.startAt.getFullYear()).toBe(2026);
      expect(eventForReferenceYear?.startAt.getMonth()).toBe(5);
      expect(eventForReferenceYear?.startAt.getDate()).toBe(20);
    });

    it('ignores contacts with invalid birthday format', async () => {
      vi.mocked(mockAdapter.execute).mockResolvedValueOnce({
        rows: [
          {
            id: 'contact-1',
            firstName: 'Alex',
            lastName: null,
            birthday: 'invalid-date'
          }
        ]
      });

      const events = await getContactBirthdayEvents(new Date('2026-01-01'));

      expect(events).toEqual([]);
    });
  });
});
