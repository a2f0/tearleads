import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EmailContext,
  type EmailContextValue
} from '../context/EmailContext.js';
import type { EmailFolder } from '../types/folder.js';
import { ALL_MAIL_ID, useEmailFolders } from './useEmailFolders.js';

const mockFolders: EmailFolder[] = [
  {
    id: '1',
    name: 'Inbox',
    folderType: 'inbox',
    parentId: null,
    unreadCount: 5
  },
  {
    id: '2',
    name: 'Sent',
    folderType: 'sent',
    parentId: null,
    unreadCount: 0
  },
  {
    id: '3',
    name: 'Work',
    folderType: 'custom',
    parentId: null,
    unreadCount: 2
  },
  {
    id: '4',
    name: 'Projects',
    folderType: 'custom',
    parentId: '3',
    unreadCount: 1
  }
];

function createMockContext(
  overrides: Partial<EmailContextValue> = {}
): EmailContextValue {
  const fetchFolders = vi.fn().mockResolvedValue(mockFolders);
  const createFolder = vi
    .fn()
    .mockImplementation(async (name: string, parentId?: string | null) => ({
      id: 'new-id',
      name,
      folderType: 'custom',
      parentId: parentId ?? null,
      unreadCount: 0
    }));
  const renameFolder = vi.fn().mockResolvedValue(undefined);
  const deleteFolder = vi.fn().mockResolvedValue(undefined);
  const moveFolder = vi.fn().mockResolvedValue(undefined);
  const initializeSystemFolders = vi.fn().mockResolvedValue(undefined);
  const getFolderByType = vi.fn().mockReturnValue(null);

  return {
    apiBaseUrl: 'http://test',
    ui: {
      BackLink: () => null,
      RefreshButton: () => null,
      DropdownMenu: () => null,
      DropdownMenuItem: () => null,
      DropdownMenuSeparator: () => null,
      AboutMenuItem: () => null,
      WindowOptionsMenuItem: () => null
    },
    folderOperations: {
      fetchFolders,
      createFolder,
      renameFolder,
      deleteFolder,
      moveFolder,
      initializeSystemFolders,
      getFolderByType
    },
    ...overrides
  };
}

function createMockContextWithoutFolderOps(): EmailContextValue {
  return {
    apiBaseUrl: 'http://test',
    ui: {
      BackLink: () => null,
      RefreshButton: () => null,
      DropdownMenu: () => null,
      DropdownMenuItem: () => null,
      DropdownMenuSeparator: () => null,
      AboutMenuItem: () => null,
      WindowOptionsMenuItem: () => null
    }
  };
}

function createWrapper(context: EmailContextValue) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <EmailContext.Provider value={context}>{children}</EmailContext.Provider>
    );
  };
}

// Suppress React act() warnings
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('useEmailFolders', () => {
  it('exports ALL_MAIL_ID', () => {
    expect(ALL_MAIL_ID).toBe('__all_mail__');
  });

  it('initializes with empty state when no operations', async () => {
    const context = createMockContextWithoutFolderOps();
    const { result } = renderHook(() => useEmailFolders(), {
      wrapper: createWrapper(context)
    });

    expect(result.current.folders).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.hasFetched).toBe(false);
  });

  it('fetches folders on mount', async () => {
    const context = createMockContext();
    const { result } = renderHook(() => useEmailFolders(), {
      wrapper: createWrapper(context)
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.folders).toEqual(mockFolders);
    expect(
      context.folderOperations?.initializeSystemFolders
    ).toHaveBeenCalled();
    expect(context.folderOperations?.fetchFolders).toHaveBeenCalled();
  });

  it('separates system and custom folders', async () => {
    const context = createMockContext();
    const { result } = renderHook(() => useEmailFolders(), {
      wrapper: createWrapper(context)
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.systemFolders).toHaveLength(2);
    expect(result.current.systemFolders[0]?.folderType).toBe('inbox');
    expect(result.current.systemFolders[1]?.folderType).toBe('sent');

    expect(result.current.customFolders).toHaveLength(2);
    expect(result.current.customFolders[0]?.folderType).toBe('custom');
  });

  it('builds tree from custom folders', async () => {
    const context = createMockContext();
    const { result } = renderHook(() => useEmailFolders(), {
      wrapper: createWrapper(context)
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.folderTree).toHaveLength(1);
    expect(result.current.folderTree[0]?.data.name).toBe('Work');
    expect(result.current.folderTree[0]?.children).toHaveLength(1);
    expect(result.current.folderTree[0]?.children[0]?.data.name).toBe(
      'Projects'
    );
  });

  it('toggleExpanded updates expanded IDs', async () => {
    const context = createMockContext();
    const { result } = renderHook(() => useEmailFolders(), {
      wrapper: createWrapper(context)
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.expandedIds.has('3')).toBe(false);

    act(() => {
      result.current.toggleExpanded('3');
    });

    expect(result.current.expandedIds.has('3')).toBe(true);

    act(() => {
      result.current.toggleExpanded('3');
    });

    expect(result.current.expandedIds.has('3')).toBe(false);
  });

  it('persists expanded IDs to localStorage', async () => {
    const context = createMockContext();
    const { result } = renderHook(() => useEmailFolders(), {
      wrapper: createWrapper(context)
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    act(() => {
      result.current.toggleExpanded('3');
    });

    const stored = localStorage.getItem('email-folders-expanded');
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored ?? '[]')).toContain('3');
  });

  it('loads expanded IDs from localStorage', async () => {
    localStorage.setItem(
      'email-folders-expanded',
      JSON.stringify(['preset-id'])
    );

    const context = createMockContext();
    const { result } = renderHook(() => useEmailFolders(), {
      wrapper: createWrapper(context)
    });

    expect(result.current.expandedIds.has('preset-id')).toBe(true);
  });

  it('createFolder adds new folder to list', async () => {
    const context = createMockContext();
    const { result } = renderHook(() => useEmailFolders(), {
      wrapper: createWrapper(context)
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    await act(async () => {
      const newFolder = await result.current.createFolder('New Folder', null);
      expect(newFolder.name).toBe('New Folder');
    });

    expect(result.current.folders).toHaveLength(5);
    expect(context.folderOperations?.createFolder).toHaveBeenCalledWith(
      'New Folder',
      null
    );
  });

  it('renameFolder updates folder in list', async () => {
    const context = createMockContext();
    const { result } = renderHook(() => useEmailFolders(), {
      wrapper: createWrapper(context)
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    await act(async () => {
      await result.current.renameFolder('3', 'Renamed Work');
    });

    const renamedFolder = result.current.folders.find((f) => f.id === '3');
    expect(renamedFolder?.name).toBe('Renamed Work');
    expect(context.folderOperations?.renameFolder).toHaveBeenCalledWith(
      '3',
      'Renamed Work'
    );
  });

  it('deleteFolder removes folder from list', async () => {
    const context = createMockContext();
    const { result } = renderHook(() => useEmailFolders(), {
      wrapper: createWrapper(context)
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    await act(async () => {
      await result.current.deleteFolder('3');
    });

    expect(result.current.folders).toHaveLength(3);
    expect(result.current.folders.find((f) => f.id === '3')).toBeUndefined();
    expect(context.folderOperations?.deleteFolder).toHaveBeenCalledWith('3');
  });

  it('moveFolder updates folder parentId', async () => {
    const context = createMockContext();
    const { result } = renderHook(() => useEmailFolders(), {
      wrapper: createWrapper(context)
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    await act(async () => {
      await result.current.moveFolder('4', null);
    });

    const movedFolder = result.current.folders.find((f) => f.id === '4');
    expect(movedFolder?.parentId).toBe(null);
    expect(context.folderOperations?.moveFolder).toHaveBeenCalledWith(
      '4',
      null
    );
  });

  it('refetch reloads folders from server', async () => {
    const context = createMockContext();
    const { result } = renderHook(() => useEmailFolders(), {
      wrapper: createWrapper(context)
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    // fetchFolders was called once during init
    expect(context.folderOperations?.fetchFolders).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(context.folderOperations?.fetchFolders).toHaveBeenCalledTimes(2);
  });

  it('sets error when fetch fails', async () => {
    const context = createMockContext();
    if (context.folderOperations) {
      context.folderOperations.fetchFolders = vi
        .fn()
        .mockRejectedValue(new Error('Fetch failed'));
    }

    const { result } = renderHook(() => useEmailFolders(), {
      wrapper: createWrapper(context)
    });

    await waitFor(() => {
      expect(result.current.error).toBe('Fetch failed');
    });
  });

  it('throws error when createFolder without operations', async () => {
    const context = createMockContextWithoutFolderOps();
    const { result } = renderHook(() => useEmailFolders(), {
      wrapper: createWrapper(context)
    });

    await expect(result.current.createFolder('test', null)).rejects.toThrow(
      'Folder operations not available'
    );
  });

  it('throws error when renameFolder without operations', async () => {
    const context = createMockContextWithoutFolderOps();
    const { result } = renderHook(() => useEmailFolders(), {
      wrapper: createWrapper(context)
    });

    await expect(result.current.renameFolder('1', 'test')).rejects.toThrow(
      'Folder operations not available'
    );
  });

  it('throws error when deleteFolder without operations', async () => {
    const context = createMockContextWithoutFolderOps();
    const { result } = renderHook(() => useEmailFolders(), {
      wrapper: createWrapper(context)
    });

    await expect(result.current.deleteFolder('1')).rejects.toThrow(
      'Folder operations not available'
    );
  });

  it('throws error when moveFolder without operations', async () => {
    const context = createMockContextWithoutFolderOps();
    const { result } = renderHook(() => useEmailFolders(), {
      wrapper: createWrapper(context)
    });

    await expect(result.current.moveFolder('1', null)).rejects.toThrow(
      'Folder operations not available'
    );
  });
});
