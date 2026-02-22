/**
 * Unit tests for analytics module.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Create mock adapter
const mockAdapter = {
  execute: vi.fn()
};

// Mock dependencies - state.ts provides getDatabaseAdapter and isDatabaseInitialized
vi.mock('./state', () => ({
  getDatabaseAdapter: vi.fn(() => mockAdapter),
  isDatabaseInitialized: vi.fn(() => true)
}));

// Import after mocks
import { getEvents } from './analytics';
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
});
