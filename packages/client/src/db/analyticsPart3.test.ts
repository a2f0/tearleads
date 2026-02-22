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
import {
  clearEvents,
  getDistinctEventTypes,
  getEventCount,
  getEventStats
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
