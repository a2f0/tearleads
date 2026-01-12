/**
 * Unit tests for analytics module.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Create mock adapter
const mockAdapter = {
  execute: vi.fn()
};

// Mock dependencies
vi.mock('./index', () => ({
  getDatabaseAdapter: vi.fn(() => mockAdapter)
}));

// Import after mocks
import {
  clearEvents,
  getDistinctEventTypes,
  getEventCount,
  getEventStats,
  getEvents,
  logApiEvent,
  logEvent,
  measureOperation
} from './analytics';
import type { Database } from './index';

// Create mock database
const mockDb = {
  insert: vi.fn(() => ({
    values: vi.fn()
  }))
} as unknown as Database;

describe('analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('logEvent', () => {
    it('inserts event with correct values', async () => {
      const mockValues = vi.fn();
      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValue({
        values: mockValues
      });

      await logEvent(mockDb, 'db_setup', 150.5, true);

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: 'db_setup',
          durationMs: 151, // Rounded
          success: true
        })
      );
    });

    it('rounds duration to nearest integer', async () => {
      const mockValues = vi.fn();
      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValue({
        values: mockValues
      });

      await logEvent(mockDb, 'db_setup', 99.4, true);

      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          durationMs: 99
        })
      );
    });

    it('generates unique ID for each event', async () => {
      const mockValues = vi.fn();
      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValue({
        values: mockValues
      });

      await logEvent(mockDb, 'db_unlock', 100, true);
      await logEvent(mockDb, 'db_session_restore', 200, true);

      const call1 = mockValues.mock.calls[0]?.[0] as { id: string };
      const call2 = mockValues.mock.calls[1]?.[0] as { id: string };

      expect(call1.id).toBeDefined();
      expect(call2.id).toBeDefined();
      expect(call1.id).not.toBe(call2.id);
    });
  });

  describe('measureOperation', () => {
    it('returns result of successful operation', async () => {
      const mockValues = vi.fn();
      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValue({
        values: mockValues
      });

      const result = await measureOperation(
        mockDb,
        'db_password_change',
        async () => 42
      );

      expect(result).toBe(42);
    });

    it('logs success event for successful operation', async () => {
      const mockValues = vi.fn();
      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValue({
        values: mockValues
      });

      await measureOperation(
        mockDb,
        'db_password_change',
        async () => 'result'
      );

      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: 'db_password_change',
          success: true
        })
      );
    });

    it('logs failure event when operation throws', async () => {
      const mockValues = vi.fn();
      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValue({
        values: mockValues
      });

      await expect(
        measureOperation(mockDb, 'file_encrypt', async () => {
          throw new Error('Operation failed');
        })
      ).rejects.toThrow('Operation failed');

      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: 'file_encrypt',
          success: false
        })
      );
    });

    it('measures duration of operation', async () => {
      const mockValues = vi.fn();
      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValue({
        values: mockValues
      });

      await measureOperation(mockDb, 'db_password_change', async () => {
        // Simulate some work
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'done';
      });

      const call = mockValues.mock.calls[0]?.[0] as { durationMs: number };
      expect(call.durationMs).toBeGreaterThan(0);
    });

    it('still throws error even if logging fails', async () => {
      const mockValues = vi.fn();
      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValue({
        values: mockValues.mockRejectedValue(new Error('Logging failed'))
      });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(
        measureOperation(mockDb, 'db_password_change', async () => {
          throw new Error('Main error');
        })
      ).rejects.toThrow('Main error');

      consoleSpy.mockRestore();
    });

    it('warns when logging fails but operation succeeds', async () => {
      const mockValues = vi.fn().mockRejectedValue(new Error('Logging failed'));
      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValue({
        values: mockValues
      });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await measureOperation(
        mockDb,
        'db_password_change',
        async () => 'success'
      );

      expect(result).toBe('success');
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to log analytics event: db_password_change'
      );

      consoleSpy.mockRestore();
    });
  });

  describe('logApiEvent', () => {
    it('inserts event via database adapter', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      await logApiEvent('api_get_ping', 150.5, true);

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO analytics_events'),
        expect.arrayContaining([
          expect.any(String), // id (UUID)
          'api_get_ping',
          151, // Rounded duration
          1, // success as 1
          expect.any(Number) // timestamp
        ])
      );
    });

    it('rounds duration to nearest integer', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      await logApiEvent('api_get_ping', 99.4, true);

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([99])
      );
    });

    it('logs failure as 0', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      await logApiEvent('api_get_admin_redis_keys', 200, false);

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([0])
      );
    });

    it('logs warning when adapter throws but does not throw', async () => {
      const error = new Error('Database not initialized');
      mockAdapter.execute.mockRejectedValue(error);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Should not throw
      await expect(
        logApiEvent('api_get_admin_redis_key', 100, true)
      ).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to log API event 'api_get_admin_redis_key':",
        error
      );

      consoleSpy.mockRestore();
    });

    it('generates unique IDs for each event', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      await logApiEvent('db_unlock', 100, true);
      await logApiEvent('db_session_restore', 200, true);

      const call1 = mockAdapter.execute.mock.calls[0]?.[1] as unknown[];
      const call2 = mockAdapter.execute.mock.calls[1]?.[1] as unknown[];

      const id1 = call1[0] as string;
      const id2 = call2[0] as string;

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
    });
  });

  describe('getEvents', () => {
    it('returns empty array when no events', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      const result = await getEvents(mockDb);

      expect(result).toEqual([]);
    });

    it('maps database rows to AnalyticsEvent objects', async () => {
      const timestamp = Date.now();
      mockAdapter.execute.mockResolvedValue({
        rows: [
          {
            id: 'event-1',
            eventName: 'db_setup',
            durationMs: 150,
            success: 1,
            timestamp
          }
        ]
      });

      const result = await getEvents(mockDb);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'event-1',
        eventName: 'db_setup',
        durationMs: 150,
        success: true,
        timestamp: new Date(timestamp),
        detail: null
      });
    });

    it('converts success 0 to false', async () => {
      mockAdapter.execute.mockResolvedValue({
        rows: [
          {
            id: 'event-1',
            eventName: 'failed-event',
            durationMs: 100,
            success: 0,
            timestamp: Date.now()
          }
        ]
      });

      const result = await getEvents(mockDb);

      expect(result[0]?.success).toBe(false);
    });

    it('applies eventName filter', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      await getEvents(mockDb, { eventName: 'specific-event' });

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('event_name = ?'),
        expect.arrayContaining(['specific-event'])
      );
    });

    it('applies startTime filter', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });
      const startTime = new Date('2024-01-01');

      await getEvents(mockDb, { startTime });

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('timestamp >= ?'),
        expect.arrayContaining([startTime.getTime()])
      );
    });

    it('applies endTime filter', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });
      const endTime = new Date('2024-12-31');

      await getEvents(mockDb, { endTime });

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('timestamp <= ?'),
        expect.arrayContaining([endTime.getTime()])
      );
    });

    it('applies limit', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      await getEvents(mockDb, { limit: 50 });

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT ?'),
        expect.arrayContaining([50])
      );
    });

    it('uses default limit of 100', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      await getEvents(mockDb);

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([100])
      );
    });

    it('combines multiple filters', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });
      const startTime = new Date('2024-01-01');
      const endTime = new Date('2024-12-31');

      await getEvents(mockDb, {
        eventName: 'db_setup',
        startTime,
        endTime,
        limit: 25
      });

      const sql = mockAdapter.execute.mock.calls[0]?.[0] as string;
      expect(sql).toContain('WHERE');
      expect(sql).toContain('event_name = ?');
      expect(sql).toContain('timestamp >= ?');
      expect(sql).toContain('timestamp <= ?');
      expect(sql).toContain('AND');
    });

    it('defaults to ORDER BY timestamp DESC when no sort specified', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      await getEvents(mockDb);

      const sql = mockAdapter.execute.mock.calls[0]?.[0] as string;
      expect(sql).toContain('ORDER BY timestamp DESC');
    });

    it('sorts by eventName ascending', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      await getEvents(mockDb, {
        sortColumn: 'eventName',
        sortDirection: 'asc'
      });

      const sql = mockAdapter.execute.mock.calls[0]?.[0] as string;
      expect(sql).toContain('ORDER BY event_name ASC');
    });

    it('sorts by eventName descending', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      await getEvents(mockDb, {
        sortColumn: 'eventName',
        sortDirection: 'desc'
      });

      const sql = mockAdapter.execute.mock.calls[0]?.[0] as string;
      expect(sql).toContain('ORDER BY event_name DESC');
    });

    it('sorts by durationMs ascending', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      await getEvents(mockDb, {
        sortColumn: 'durationMs',
        sortDirection: 'asc'
      });

      const sql = mockAdapter.execute.mock.calls[0]?.[0] as string;
      expect(sql).toContain('ORDER BY duration_ms ASC');
    });

    it('sorts by durationMs descending', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      await getEvents(mockDb, {
        sortColumn: 'durationMs',
        sortDirection: 'desc'
      });

      const sql = mockAdapter.execute.mock.calls[0]?.[0] as string;
      expect(sql).toContain('ORDER BY duration_ms DESC');
    });

    it('sorts by success ascending', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      await getEvents(mockDb, { sortColumn: 'success', sortDirection: 'asc' });

      const sql = mockAdapter.execute.mock.calls[0]?.[0] as string;
      expect(sql).toContain('ORDER BY success ASC');
    });

    it('sorts by success descending', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      await getEvents(mockDb, { sortColumn: 'success', sortDirection: 'desc' });

      const sql = mockAdapter.execute.mock.calls[0]?.[0] as string;
      expect(sql).toContain('ORDER BY success DESC');
    });

    it('sorts by timestamp ascending', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      await getEvents(mockDb, {
        sortColumn: 'timestamp',
        sortDirection: 'asc'
      });

      const sql = mockAdapter.execute.mock.calls[0]?.[0] as string;
      expect(sql).toContain('ORDER BY timestamp ASC');
    });

    it('sorts by timestamp descending', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      await getEvents(mockDb, {
        sortColumn: 'timestamp',
        sortDirection: 'desc'
      });

      const sql = mockAdapter.execute.mock.calls[0]?.[0] as string;
      expect(sql).toContain('ORDER BY timestamp DESC');
    });

    it('combines sort with filters', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });
      const startTime = new Date('2024-01-01');

      await getEvents(mockDb, {
        startTime,
        sortColumn: 'durationMs',
        sortDirection: 'desc'
      });

      const sql = mockAdapter.execute.mock.calls[0]?.[0] as string;
      expect(sql).toContain('WHERE');
      expect(sql).toContain('timestamp >= ?');
      expect(sql).toContain('ORDER BY duration_ms DESC');
    });

    it('uses default sort when only sortColumn is provided', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      await getEvents(mockDb, { sortColumn: 'eventName' });

      const sql = mockAdapter.execute.mock.calls[0]?.[0] as string;
      // Should use default since sortDirection is missing
      expect(sql).toContain('ORDER BY timestamp DESC');
    });

    it('uses default sort when only sortDirection is provided', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      await getEvents(mockDb, { sortDirection: 'asc' });

      const sql = mockAdapter.execute.mock.calls[0]?.[0] as string;
      // Should use default since sortColumn is missing
      expect(sql).toContain('ORDER BY timestamp DESC');
    });

    it('filters out rows with invalid numeric fields', async () => {
      mockAdapter.execute.mockResolvedValue({
        rows: [
          {
            id: '1',
            eventName: 'event1',
            durationMs: 'invalid',
            success: 1,
            timestamp: 1000,
            detail: null
          },
          {
            id: '2',
            eventName: 'event2',
            durationMs: 100,
            success: 'invalid',
            timestamp: 1000,
            detail: null
          },
          {
            id: '3',
            eventName: 'event3',
            durationMs: 100,
            success: 1,
            timestamp: 'invalid',
            detail: null
          },
          {
            id: '4',
            eventName: 'event4',
            durationMs: 100,
            success: 1,
            timestamp: 1000,
            detail: null
          }
        ]
      });

      const result = await getEvents(mockDb);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('4');
    });

    it('filters out rows that are not records', async () => {
      mockAdapter.execute.mockResolvedValue({
        rows: [
          null,
          'not a record',
          123,
          {
            id: '1',
            eventName: 'valid',
            durationMs: 100,
            success: 1,
            timestamp: 1000,
            detail: null
          }
        ]
      });

      const result = await getEvents(mockDb);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('1');
    });

    it('filters out rows with missing or invalid id/eventName', async () => {
      mockAdapter.execute.mockResolvedValue({
        rows: [
          {
            eventName: 'missing-id',
            durationMs: 100,
            success: 1,
            timestamp: 1000,
            detail: null
          },
          {
            id: 123,
            eventName: 'id-not-string',
            durationMs: 100,
            success: 1,
            timestamp: 1000,
            detail: null
          },
          {
            id: '1',
            durationMs: 100,
            success: 1,
            timestamp: 1000,
            detail: null
          },
          {
            id: '2',
            eventName: 123,
            durationMs: 100,
            success: 1,
            timestamp: 1000,
            detail: null
          },
          {
            id: '3',
            eventName: 'valid',
            durationMs: 100,
            success: 1,
            timestamp: 1000,
            detail: null
          }
        ]
      });

      const result = await getEvents(mockDb);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('3');
    });

    it('handles invalid JSON in detail field gracefully', async () => {
      mockAdapter.execute.mockResolvedValue({
        rows: [
          {
            id: '1',
            eventName: 'event1',
            durationMs: 100,
            success: 1,
            timestamp: 1000,
            detail: 'not valid json {'
          }
        ]
      });

      const result = await getEvents(mockDb);

      expect(result).toHaveLength(1);
      expect(result[0]?.detail).toBeNull();
    });

    it('handles array in detail field gracefully', async () => {
      mockAdapter.execute.mockResolvedValue({
        rows: [
          {
            id: '1',
            eventName: 'event1',
            durationMs: 100,
            success: 1,
            timestamp: 1000,
            detail: '[1, 2, 3]'
          }
        ]
      });

      const result = await getEvents(mockDb);

      expect(result).toHaveLength(1);
      expect(result[0]?.detail).toBeNull();
    });
  });

  describe('getEventStats', () => {
    it('returns empty array when no stats', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      const result = await getEventStats(mockDb);

      expect(result).toEqual([]);
    });

    it('calculates stats from database rows', async () => {
      mockAdapter.execute.mockResolvedValue({
        rows: [
          {
            eventName: 'db_setup',
            count: 10,
            totalDuration: 1500,
            minDuration: 50,
            maxDuration: 300,
            successCount: 8
          }
        ]
      });

      const result = await getEventStats(mockDb);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        eventName: 'db_setup',
        count: 10,
        avgDurationMs: 150,
        minDurationMs: 50,
        maxDurationMs: 300,
        successRate: 80
      });
    });

    it('handles zero count gracefully', async () => {
      mockAdapter.execute.mockResolvedValue({
        rows: [
          {
            eventName: 'empty-event',
            count: 0,
            totalDuration: 0,
            minDuration: 0,
            maxDuration: 0,
            successCount: 0
          }
        ]
      });

      const result = await getEventStats(mockDb);

      expect(result[0]).toEqual({
        eventName: 'empty-event',
        count: 0,
        avgDurationMs: 0,
        minDurationMs: 0,
        maxDurationMs: 0,
        successRate: 0
      });
    });

    it('applies eventName filter', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      await getEventStats(mockDb, { eventName: 'specific-event' });

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('event_name = ?'),
        expect.arrayContaining(['specific-event'])
      );
    });

    it('applies startTime filter', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });
      const startTime = new Date('2024-01-01');

      await getEventStats(mockDb, { startTime });

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('timestamp >= ?'),
        expect.arrayContaining([startTime.getTime()])
      );
    });

    it('applies endTime filter', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });
      const endTime = new Date('2024-12-31');

      await getEventStats(mockDb, { endTime });

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('timestamp <= ?'),
        expect.arrayContaining([endTime.getTime()])
      );
    });

    it('handles null values in row data', async () => {
      mockAdapter.execute.mockResolvedValue({
        rows: [
          {
            eventName: 'db_setup',
            count: null,
            totalDuration: null,
            minDuration: null,
            maxDuration: null,
            successCount: null
          }
        ]
      });

      const result = await getEventStats(mockDb);

      // null values are converted to 0 via nullish coalescing
      expect(result[0]).toEqual({
        eventName: 'db_setup',
        count: 0,
        avgDurationMs: 0,
        minDurationMs: 0,
        maxDurationMs: 0,
        successRate: 0
      });
    });

    it('filters out invalid rows (not a record)', async () => {
      mockAdapter.execute.mockResolvedValue({
        rows: [
          null,
          'invalid',
          123,
          {
            eventName: 'valid',
            count: 5,
            totalDuration: 100,
            minDuration: 10,
            maxDuration: 30,
            successCount: 4
          }
        ]
      });

      const result = await getEventStats(mockDb);

      expect(result).toHaveLength(1);
      expect(result[0]?.eventName).toBe('valid');
    });

    it('filters out rows with missing eventName', async () => {
      mockAdapter.execute.mockResolvedValue({
        rows: [
          {
            count: 5,
            totalDuration: 100,
            minDuration: 10,
            maxDuration: 30,
            successCount: 4
          },
          {
            eventName: 123,
            count: 5,
            totalDuration: 100,
            minDuration: 10,
            maxDuration: 30,
            successCount: 4
          },
          {
            eventName: 'valid',
            count: 5,
            totalDuration: 100,
            minDuration: 10,
            maxDuration: 30,
            successCount: 4
          }
        ]
      });

      const result = await getEventStats(mockDb);

      expect(result).toHaveLength(1);
      expect(result[0]?.eventName).toBe('valid');
    });

    it('applies sort column and direction', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      await getEventStats(mockDb, {
        sortColumn: 'avgDurationMs',
        sortDirection: 'desc'
      });

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining(
          'ORDER BY sum(duration_ms) * 1.0 / count(*) DESC'
        ),
        []
      );
    });
  });

  describe('clearEvents', () => {
    it('deletes all events from database', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      await clearEvents(mockDb);

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        'DELETE FROM analytics_events',
        []
      );
    });
  });

  describe('getEventCount', () => {
    it('returns count from database', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [{ count: 42 }] });

      const result = await getEventCount(mockDb);

      expect(result).toBe(42);
    });

    it('returns 0 when no rows', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      const result = await getEventCount(mockDb);

      expect(result).toBe(0);
    });

    it('returns 0 when row has undefined count', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [{}] });

      const result = await getEventCount(mockDb);

      expect(result).toBe(0);
    });

    it('applies startTime filter when provided', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [{ count: 10 }] });
      const startTime = new Date('2024-01-01T00:00:00Z');

      const result = await getEventCount(mockDb, { startTime });

      expect(result).toBe(10);
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('WHERE timestamp >= ?'),
        [startTime.getTime()]
      );
    });

    it('applies endTime filter when provided', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [{ count: 5 }] });
      const endTime = new Date('2024-12-31T23:59:59Z');

      const result = await getEventCount(mockDb, { endTime });

      expect(result).toBe(5);
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('WHERE timestamp <= ?'),
        [endTime.getTime()]
      );
    });

    it('applies both startTime and endTime filters when provided', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [{ count: 3 }] });
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-12-31T23:59:59Z');

      const result = await getEventCount(mockDb, { startTime, endTime });

      expect(result).toBe(3);
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        expect.stringContaining('WHERE timestamp >= ? AND timestamp <= ?'),
        [startTime.getTime(), endTime.getTime()]
      );
    });
  });

  describe('getDistinctEventTypes', () => {
    it('returns list of distinct event names', async () => {
      mockAdapter.execute.mockResolvedValue({
        rows: [
          { eventName: 'event-a' },
          { eventName: 'event-b' },
          { eventName: 'event-c' }
        ]
      });

      const result = await getDistinctEventTypes(mockDb);

      expect(result).toEqual(['event-a', 'event-b', 'event-c']);
    });

    it('returns empty array when no events', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      const result = await getDistinctEventTypes(mockDb);

      expect(result).toEqual([]);
    });

    it('filters out invalid rows', async () => {
      mockAdapter.execute.mockResolvedValue({
        rows: [
          { eventName: 'valid-event' },
          { notEventName: 'invalid' },
          null,
          { eventName: 123 }, // Wrong type
          { eventName: 'another-valid' }
        ]
      });

      const result = await getDistinctEventTypes(mockDb);

      expect(result).toEqual(['valid-event', 'another-valid']);
    });

    it('executes correct SQL query', async () => {
      mockAdapter.execute.mockResolvedValue({ rows: [] });

      await getDistinctEventTypes(mockDb);

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        'SELECT DISTINCT event_name as eventName FROM analytics_events ORDER BY event_name',
        []
      );
    });
  });
});
