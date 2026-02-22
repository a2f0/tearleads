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
import { logApiEvent, logEvent, measureOperation } from './analytics';
import type { Database } from './index';
import { isDatabaseInitialized } from './state';

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

    it('skips logging when database is not initialized', async () => {
      vi.mocked(isDatabaseInitialized).mockReturnValueOnce(false);

      await logApiEvent('api_get_ping', 100, true);

      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });
  });
});
