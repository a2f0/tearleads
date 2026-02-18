import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VFS_ROOT_ID } from '../constants';
import {
  createMockDatabase,
  createMockDatabaseState,
  createWrapper
} from '../test/testUtils';
import { useVfsFolders } from './useVfsFolders';

describe('useVfsFolders', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
  });

  it('returns empty folders when not unlocked', () => {
    const wrapper = createWrapper({
      databaseState: { isUnlocked: false, currentInstanceId: null }
    });

    const { result } = renderHook(() => useVfsFolders(), { wrapper });

    expect(result.current.folders).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('fetches folders when unlocked', async () => {
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

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsFolders(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.folders).toHaveLength(2);
    expect(result.current.folders[0]?.name).toBe('Folder 1');
    expect(result.current.folders[1]?.name).toBe('Folder 2');
  });

  it('builds folder hierarchy from links', async () => {
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

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsFolders(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.folders).toHaveLength(1);
    expect(result.current.folders[0]?.name).toBe('Parent');
    expect(result.current.folders[0]?.children).toHaveLength(1);
    expect(result.current.folders[0]?.children?.[0]?.name).toBe('Child');
  });

  it('falls back to Unnamed Folder when metadata is missing', async () => {
    const mockFolderRows = [
      { id: 'folder-1', name: '', createdAt: Date.now() }
    ];
    const mockLinkRows: { childId: string; parentId: string }[] = [];
    const mockChildCountRows: { parentId: string }[] = [];

    mockDb.where
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

    expect(result.current.folders).toHaveLength(1);
    expect(result.current.folders[0]?.name).toBe('Unnamed Folder');
  });

  it('handles fetch errors', async () => {
    mockDb.where.mockRejectedValueOnce(new Error('Database error'));

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsFolders(), { wrapper });

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
    mockDb.where.mockResolvedValueOnce([]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsFolders(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.folders).toEqual([]);
  });

  it('includes the VFS root in returned folders', async () => {
    const mockFolderRows = [
      { id: VFS_ROOT_ID, name: 'VFS Root', createdAt: Date.now() },
      { id: 'folder-1', name: 'My Folder', createdAt: Date.now() }
    ];

    // folder-1 is a child of VFS_ROOT
    const mockLinkRows = [{ childId: 'folder-1', parentId: VFS_ROOT_ID }];
    const mockChildCountRows = [{ parentId: VFS_ROOT_ID }];

    mockDb.where
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

    expect(result.current.folders).toHaveLength(1);
    expect(result.current.folders[0]?.id).toBe(VFS_ROOT_ID);
    expect(result.current.folders[0]?.name).toBe('VFS Root');
    expect(result.current.folders[0]?.parentId).toBeNull();
    expect(result.current.folders[0]?.children).toHaveLength(1);
    expect(result.current.folders[0]?.children?.[0]?.id).toBe('folder-1');
    expect(result.current.folders[0]?.children?.[0]?.name).toBe('My Folder');
    expect(result.current.folders[0]?.children?.[0]?.parentId).toBe(
      VFS_ROOT_ID
    );
  });

  it('provides refetch function that reloads data', async () => {
    const mockFolderRows = [
      { id: 'folder-1', name: 'Folder 1', createdAt: Date.now() }
    ];

    const mockLinkRows: { childId: string; parentId: string }[] = [];
    const mockChildCountRows: { parentId: string }[] = [];

    mockDb.where
      .mockResolvedValueOnce(mockFolderRows)
      .mockResolvedValueOnce(mockLinkRows)
      .mockResolvedValueOnce(mockChildCountRows)
      // Second fetch after refetch call
      .mockResolvedValueOnce(mockFolderRows)
      .mockResolvedValueOnce(mockLinkRows)
      .mockResolvedValueOnce(mockChildCountRows);

    const wrapper = createWrapper({
      databaseState: {
        isUnlocked: true,
        isLoading: false,
        currentInstanceId: 'instance-1'
      },
      database: mockDb
    });

    const { result } = renderHook(() => useVfsFolders(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    // Should have fetched once
    expect(mockDb.where).toHaveBeenCalledTimes(3);

    // Call refetch
    await act(async () => {
      await result.current.refetch();
    });

    // Should have fetched again
    expect(mockDb.where).toHaveBeenCalledTimes(6);
  });
});
