import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock database
vi.mock('@/db', () => ({
  getDatabase: vi.fn()
}));

// Mock database context
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: vi.fn()
}));

import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { useVfsFolders } from './useVfsFolders';

describe('useVfsFolders', () => {
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDatabase).mockReturnValue(
      mockDb as unknown as ReturnType<typeof getDatabase>
    );
  });

  it('returns empty folders when not unlocked', () => {
    vi.mocked(useDatabaseContext).mockReturnValue({
      isUnlocked: false,
      currentInstanceId: null
    } as ReturnType<typeof useDatabaseContext>);

    const { result } = renderHook(() => useVfsFolders());

    expect(result.current.folders).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('fetches folders when unlocked', async () => {
    vi.mocked(useDatabaseContext).mockReturnValue({
      isUnlocked: true,
      currentInstanceId: 'test-instance'
    } as ReturnType<typeof useDatabaseContext>);

    const mockFolderRows = [
      { id: 'folder-1', name: 'Folder 1', createdAt: Date.now() },
      { id: 'folder-2', name: 'Folder 2', createdAt: Date.now() }
    ];

    const mockLinkRows: { childId: string; parentId: string }[] = [];
    const mockChildCountRows: { parentId: string }[] = [];

    mockDb.where
      .mockResolvedValueOnce(mockFolderRows)
      .mockResolvedValueOnce(mockLinkRows)
      .mockResolvedValueOnce(mockChildCountRows);

    const { result } = renderHook(() => useVfsFolders());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.folders).toHaveLength(2);
    expect(result.current.folders[0]?.name).toBe('Folder 1');
    expect(result.current.folders[1]?.name).toBe('Folder 2');
  });

  it('builds folder hierarchy from links', async () => {
    vi.mocked(useDatabaseContext).mockReturnValue({
      isUnlocked: true,
      currentInstanceId: 'test-instance'
    } as ReturnType<typeof useDatabaseContext>);

    const mockFolderRows = [
      { id: 'parent', name: 'Parent', createdAt: Date.now() },
      { id: 'child', name: 'Child', createdAt: Date.now() }
    ];

    const mockLinkRows = [{ childId: 'child', parentId: 'parent' }];
    const mockChildCountRows = [{ parentId: 'parent' }];

    mockDb.where
      .mockResolvedValueOnce(mockFolderRows)
      .mockResolvedValueOnce(mockLinkRows)
      .mockResolvedValueOnce(mockChildCountRows);

    const { result } = renderHook(() => useVfsFolders());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.folders).toHaveLength(1);
    expect(result.current.folders[0]?.name).toBe('Parent');
    expect(result.current.folders[0]?.children).toHaveLength(1);
    expect(result.current.folders[0]?.children?.[0]?.name).toBe('Child');
  });

  it('handles fetch errors', async () => {
    vi.mocked(useDatabaseContext).mockReturnValue({
      isUnlocked: true,
      currentInstanceId: 'test-instance'
    } as ReturnType<typeof useDatabaseContext>);

    mockDb.where.mockRejectedValueOnce(new Error('Database error'));

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { result } = renderHook(() => useVfsFolders());

    await waitFor(() => {
      expect(result.current.error).toBe('Database error');
    });

    expect(result.current.folders).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to fetch VFS folders:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });

  it('returns empty folders when no folders exist', async () => {
    vi.mocked(useDatabaseContext).mockReturnValue({
      isUnlocked: true,
      currentInstanceId: 'test-instance'
    } as ReturnType<typeof useDatabaseContext>);

    mockDb.where.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useVfsFolders());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.folders).toEqual([]);
  });

  it('refetches when instance changes', async () => {
    const mockContext = {
      isUnlocked: true,
      currentInstanceId: 'instance-1'
    } as ReturnType<typeof useDatabaseContext>;

    vi.mocked(useDatabaseContext).mockReturnValue(mockContext);

    mockDb.where
      .mockResolvedValueOnce([{ id: 'f1', name: 'F1', createdAt: Date.now() }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { result, rerender } = renderHook(() => useVfsFolders());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    // Change instance
    vi.mocked(useDatabaseContext).mockReturnValue({
      isUnlocked: true,
      currentInstanceId: 'instance-2'
    } as ReturnType<typeof useDatabaseContext>);

    mockDb.where
      .mockResolvedValueOnce([{ id: 'f2', name: 'F2', createdAt: Date.now() }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    rerender();

    await waitFor(() => {
      expect(result.current.folders[0]?.name).toBe('F2');
    });
  });
});
