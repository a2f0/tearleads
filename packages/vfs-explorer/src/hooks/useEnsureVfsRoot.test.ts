import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VFS_ROOT_ID } from '../constants';
import {
  createMockDatabase,
  createMockDatabaseState,
  createWrapper
} from '../test/testUtils';
import { useEnsureVfsRoot } from './useEnsureVfsRoot';

describe('useEnsureVfsRoot', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
  });

  it('returns not ready when database is not unlocked', () => {
    const wrapper = createWrapper({
      databaseState: { isUnlocked: false, currentInstanceId: null }
    });

    const { result } = renderHook(() => useEnsureVfsRoot(), { wrapper });

    expect(result.current.isReady).toBe(false);
    expect(result.current.isCreating).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('becomes ready when root already exists', async () => {
    // Root already exists in database
    mockDb.limit.mockResolvedValueOnce([{ id: VFS_ROOT_ID }]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useEnsureVfsRoot(), { wrapper });

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    expect(result.current.error).toBeNull();
    // Should have only checked for existence, not created
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('creates root when it does not exist', async () => {
    // Root does not exist
    mockDb.limit.mockResolvedValueOnce([]);
    const insertedValues: Array<Record<string, unknown>> = [];
    mockDb.transaction.mockImplementationOnce(async (callback) => {
      await callback({
        insert: vi.fn(() => ({
          values: vi.fn(async (value) => {
            if (typeof value === 'object' && value !== null) {
              insertedValues.push(value as Record<string, unknown>);
            }
          })
        }))
      });
    });

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useEnsureVfsRoot(), { wrapper });

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    expect(result.current.error).toBeNull();
    // Should have created the root
    expect(mockDb.transaction).toHaveBeenCalled();
    expect(insertedValues[0]?.['encryptedName']).toBe('VFS Root');
    expect(insertedValues).toHaveLength(1);
  });

  it('handles errors during root creation', async () => {
    mockDb.limit.mockResolvedValueOnce([]);
    mockDb.transaction.mockRejectedValueOnce(new Error('Database error'));

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useEnsureVfsRoot(), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBe('Database error');
    });

    expect(result.current.isReady).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to ensure VFS root:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });
});
