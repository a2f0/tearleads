import { renderHook, waitFor } from '@testing-library/react';
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
      {
        id: 'folder-1',
        objectType: 'folder',
        name: 'Folder 1',
        createdAt: Date.now()
      },
      {
        id: 'folder-2',
        objectType: 'folder',
        name: 'Folder 2',
        createdAt: Date.now()
      }
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

  it('includes top-level and nested playlist containers in the tree', async () => {
    const mockFolderRows = [
      {
        id: 'folder-1',
        objectType: 'folder',
        name: 'Folder 1',
        createdAt: Date.now()
      },
      {
        id: 'playlist-1',
        objectType: 'playlist',
        name: 'Road Trip',
        createdAt: Date.now()
      },
      {
        id: 'playlist-root',
        objectType: 'playlist',
        name: 'Top Level Playlist',
        createdAt: Date.now()
      }
    ];
    const mockLinkRows = [
      { childId: 'playlist-1', parentId: 'folder-1' },
      { childId: 'playlist-root', parentId: VFS_ROOT_ID }
    ];
    const mockChildCountRows = [
      { parentId: 'folder-1' },
      { parentId: VFS_ROOT_ID }
    ];

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

    const nestedPlaylistParent = result.current.folders.find(
      (node) => node.id === 'folder-1'
    );
    expect(nestedPlaylistParent?.children).toHaveLength(1);
    expect(nestedPlaylistParent?.children?.[0]?.id).toBe('playlist-1');
    expect(nestedPlaylistParent?.children?.[0]?.objectType).toBe('playlist');

    const topLevelPlaylist = result.current.folders.find(
      (node) => node.id === 'playlist-root'
    );
    expect(topLevelPlaylist?.objectType).toBe('playlist');
  });

  it('includes top-level and nested email folders in the tree', async () => {
    const mockFolderRows = [
      {
        id: VFS_ROOT_ID,
        objectType: 'folder',
        name: 'VFS Root',
        createdAt: Date.now()
      },
      {
        id: 'email-inbox',
        objectType: 'emailFolder',
        name: 'Inbox',
        createdAt: Date.now()
      },
      {
        id: 'email-projects',
        objectType: 'emailFolder',
        name: 'Projects',
        createdAt: Date.now()
      }
    ];

    const mockLinkRows = [
      { childId: 'email-inbox', parentId: VFS_ROOT_ID },
      { childId: 'email-projects', parentId: 'email-inbox' }
    ];
    const mockChildCountRows = [
      { parentId: VFS_ROOT_ID },
      { parentId: 'email-inbox' }
    ];

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

    const rootNode = result.current.folders.find(
      (node) => node.id === VFS_ROOT_ID
    );
    expect(rootNode?.children).toHaveLength(1);
    expect(rootNode?.children?.[0]?.id).toBe('email-inbox');
    expect(rootNode?.children?.[0]?.objectType).toBe('emailFolder');
    expect(rootNode?.children?.[0]?.children?.[0]?.id).toBe('email-projects');
  });

  it('includes contact containers as top-level roots and nested children', async () => {
    const mockFolderRows = [
      {
        id: 'folder-1',
        objectType: 'folder',
        name: 'Folder 1',
        createdAt: Date.now()
      },
      {
        id: 'contact-root',
        objectType: 'contact',
        name: 'Alice',
        createdAt: Date.now()
      },
      {
        id: 'contact-nested',
        objectType: 'contact',
        name: 'Bob',
        createdAt: Date.now()
      }
    ];
    const mockLinkRows = [{ childId: 'contact-nested', parentId: 'folder-1' }];
    const mockChildCountRows = [{ parentId: 'folder-1' }];

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

    const topLevelContact = result.current.folders.find(
      (node) => node.id === 'contact-root'
    );
    expect(topLevelContact?.objectType).toBe('contact');

    const folderNode = result.current.folders.find(
      (node) => node.id === 'folder-1'
    );
    expect(folderNode?.children?.[0]?.id).toBe('contact-nested');
    expect(folderNode?.children?.[0]?.objectType).toBe('contact');
  });

  it('includes unlinked email folders as top-level roots', async () => {
    const mockFolderRows = [
      {
        id: VFS_ROOT_ID,
        objectType: 'folder',
        name: 'VFS Root',
        createdAt: Date.now()
      },
      {
        id: 'email-inbox',
        objectType: 'emailFolder',
        name: 'Inbox',
        createdAt: Date.now()
      },
      {
        id: 'email-drafts',
        objectType: 'emailFolder',
        name: 'Drafts',
        createdAt: Date.now()
      }
    ];
    const mockLinkRows = [{ childId: 'email-inbox', parentId: VFS_ROOT_ID }];
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

    const rootNode = result.current.folders.find(
      (node) => node.id === VFS_ROOT_ID
    );
    expect(rootNode?.children).toHaveLength(1);
    expect(rootNode?.children?.[0]?.id).toBe('email-inbox');
    const topLevelDrafts = result.current.folders.find(
      (node) => node.id === 'email-drafts'
    );
    expect(topLevelDrafts?.objectType).toBe('emailFolder');
  });

  it('builds folder hierarchy from links', async () => {
    const mockFolderRows = [
      {
        id: 'parent',
        objectType: 'folder',
        name: 'Parent',
        createdAt: Date.now()
      },
      {
        id: 'child',
        objectType: 'folder',
        name: 'Child',
        createdAt: Date.now()
      }
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

  it('accepts SQL-resolved unnamed folder labels', async () => {
    const mockFolderRows = [
      {
        id: 'folder-1',
        objectType: 'folder',
        name: 'Unnamed Folder',
        createdAt: Date.now()
      }
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

  it('accepts SQL-resolved unnamed contact labels', async () => {
    const mockFolderRows = [
      {
        id: 'contact-1',
        objectType: 'contact',
        name: 'Unnamed Contact',
        createdAt: Date.now()
      }
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
    expect(result.current.folders[0]?.name).toBe('Unnamed Contact');
    expect(result.current.folders[0]?.objectType).toBe('contact');
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
      {
        id: VFS_ROOT_ID,
        objectType: 'folder',
        name: 'VFS Root',
        createdAt: Date.now()
      },
      {
        id: 'folder-1',
        objectType: 'folder',
        name: 'My Folder',
        createdAt: Date.now()
      }
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
});
