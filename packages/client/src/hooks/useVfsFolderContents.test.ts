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
import { useVfsFolderContents } from './useVfsFolderContents';

describe('useVfsFolderContents', () => {
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

  it('returns empty items when not unlocked', () => {
    vi.mocked(useDatabaseContext).mockReturnValue({
      isUnlocked: false,
      currentInstanceId: null
    } as ReturnType<typeof useDatabaseContext>);

    const { result } = renderHook(() => useVfsFolderContents('folder-1'));

    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('returns empty items when folderId is null', async () => {
    vi.mocked(useDatabaseContext).mockReturnValue({
      isUnlocked: true,
      currentInstanceId: 'test-instance'
    } as ReturnType<typeof useDatabaseContext>);

    const { result } = renderHook(() => useVfsFolderContents(null));

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.items).toEqual([]);
  });

  it('fetches folder contents when unlocked', async () => {
    vi.mocked(useDatabaseContext).mockReturnValue({
      isUnlocked: true,
      currentInstanceId: 'test-instance'
    } as ReturnType<typeof useDatabaseContext>);

    const mockLinkRows = [
      { linkId: 'link-1', childId: 'child-1' },
      { linkId: 'link-2', childId: 'child-2' }
    ];

    const mockRegistryRows = [
      { id: 'child-1', objectType: 'folder', createdAt: Date.now() },
      { id: 'child-2', objectType: 'note', createdAt: Date.now() }
    ];

    const mockFolderNameRows = [{ id: 'child-1', name: 'Subfolder' }];
    const mockNoteRows = [{ id: 'child-2', title: 'My Note' }];

    mockDb.where
      .mockResolvedValueOnce(mockLinkRows)
      .mockResolvedValueOnce(mockRegistryRows)
      .mockResolvedValueOnce(mockFolderNameRows)
      .mockResolvedValueOnce(mockNoteRows);

    const { result } = renderHook(() => useVfsFolderContents('parent-folder'));

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0]?.name).toBe('Subfolder');
    expect(result.current.items[0]?.objectType).toBe('folder');
    expect(result.current.items[1]?.name).toBe('My Note');
    expect(result.current.items[1]?.objectType).toBe('note');
  });

  it('returns empty items when folder has no children', async () => {
    vi.mocked(useDatabaseContext).mockReturnValue({
      isUnlocked: true,
      currentInstanceId: 'test-instance'
    } as ReturnType<typeof useDatabaseContext>);

    mockDb.where.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useVfsFolderContents('empty-folder'));

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.items).toEqual([]);
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

    const { result } = renderHook(() => useVfsFolderContents('folder-1'));

    await waitFor(() => {
      expect(result.current.error).toBe('Database error');
    });

    expect(result.current.items).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to fetch VFS folder contents:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });

  it('sorts folders first then alphabetically', async () => {
    vi.mocked(useDatabaseContext).mockReturnValue({
      isUnlocked: true,
      currentInstanceId: 'test-instance'
    } as ReturnType<typeof useDatabaseContext>);

    const mockLinkRows = [
      { linkId: 'link-1', childId: 'note-1' },
      { linkId: 'link-2', childId: 'folder-1' },
      { linkId: 'link-3', childId: 'note-2' }
    ];

    const mockRegistryRows = [
      { id: 'note-1', objectType: 'note', createdAt: Date.now() },
      { id: 'folder-1', objectType: 'folder', createdAt: Date.now() },
      { id: 'note-2', objectType: 'note', createdAt: Date.now() }
    ];

    const mockFolderNameRows = [{ id: 'folder-1', name: 'Zebra Folder' }];
    const mockNoteRows = [
      { id: 'note-1', title: 'Apple Note' },
      { id: 'note-2', title: 'Banana Note' }
    ];

    mockDb.where
      .mockResolvedValueOnce(mockLinkRows)
      .mockResolvedValueOnce(mockRegistryRows)
      .mockResolvedValueOnce(mockFolderNameRows)
      .mockResolvedValueOnce(mockNoteRows);

    const { result } = renderHook(() => useVfsFolderContents('parent'));

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.items[0]?.objectType).toBe('folder');
    expect(result.current.items[1]?.name).toBe('Apple Note');
    expect(result.current.items[2]?.name).toBe('Banana Note');
  });

  it('refetches when folderId changes', async () => {
    vi.mocked(useDatabaseContext).mockReturnValue({
      isUnlocked: true,
      currentInstanceId: 'test-instance'
    } as ReturnType<typeof useDatabaseContext>);

    mockDb.where.mockResolvedValue([]);

    const { result, rerender } = renderHook(
      ({ folderId }) => useVfsFolderContents(folderId),
      { initialProps: { folderId: 'folder-1' } }
    );

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    // Change folder
    rerender({ folderId: 'folder-2' });

    await waitFor(() => {
      expect(mockDb.where).toHaveBeenCalled();
    });
  });
});
