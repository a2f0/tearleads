import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockDatabase,
  createMockDatabaseState,
  createWrapper
} from '../test/testUtils';
import { useVfsTrashItems } from './useVfsTrashItems';

describe('useVfsTrashItems', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
  });

  it('returns empty items when not unlocked', () => {
    const wrapper = createWrapper({
      databaseState: { isUnlocked: false, currentInstanceId: null }
    });

    const { result } = renderHook(() => useVfsTrashItems(), { wrapper });

    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('fetches deleted items when unlocked', async () => {
    mockDb.orderBy.mockResolvedValueOnce([
      {
        id: 'deleted-1',
        objectType: 'file',
        name: 'Deleted Doc',
        createdAt: new Date()
      }
    ]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsTrashItems(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.name).toBe('Deleted Doc');
  });

  it('skips fetch when enabled is false', () => {
    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    renderHook(() => useVfsTrashItems({ enabled: false }), { wrapper });

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('handles database errors', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    mockDb.orderBy.mockRejectedValueOnce(new Error('Trash query failed'));

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsTrashItems(), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBe('Trash query failed');
    });

    consoleError.mockRestore();
  });
});
