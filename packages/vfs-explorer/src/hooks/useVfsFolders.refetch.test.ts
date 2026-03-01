import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockDatabase,
  createMockDatabaseState,
  createWrapper
} from '../test/testUtils';
import { useVfsFolders } from './useVfsFolders';

describe('useVfsFolders refetch', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
  });

  it('provides refetch function that reloads data', async () => {
    const mockFolderRows = [
      {
        id: 'folder-1',
        objectType: 'folder',
        name: 'Folder 1',
        createdAt: Date.now()
      }
    ];
    const mockLinkRows: { childId: string; parentId: string }[] = [];
    const mockChildCountRows: { parentId: string }[] = [];

    mockDb.where
      .mockResolvedValueOnce(mockFolderRows)
      .mockResolvedValueOnce(mockLinkRows)
      .mockResolvedValueOnce(mockChildCountRows)
      .mockResolvedValueOnce(mockFolderRows)
      .mockResolvedValueOnce(mockLinkRows)
      .mockResolvedValueOnce(mockChildCountRows);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsFolders(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });
    expect(mockDb.where).toHaveBeenCalledTimes(3);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockDb.where).toHaveBeenCalledTimes(6);
  });
});
