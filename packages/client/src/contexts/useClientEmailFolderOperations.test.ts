import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useClientEmailFolderOperations } from './useClientEmailFolderOperations';

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn()
};

vi.mock('@/db', () => ({
  getDatabase: () => mockDb
}));

vi.mock('@/db/localWrite', () => ({
  runLocalWrite: async (fn: () => Promise<unknown>) => fn()
}));

vi.mock('@/db/schema', () => ({
  emails: { id: 'emails.id', isRead: 'emails.is_read' },
  vfsLinks: {
    parentId: 'vfs_links.parent_id',
    childId: 'vfs_links.child_id',
    id: 'vfs_links.id'
  },
  vfsRegistry: {
    id: 'vfs_registry.id',
    objectType: 'vfs_registry.object_type',
    encryptedName: 'vfs_registry.encrypted_name',
    ownerId: 'vfs_registry.owner_id',
    createdAt: 'vfs_registry.created_at'
  }
}));

function mockQueryChain(result: unknown) {
  return {
    from: vi.fn(() => ({
      leftJoin: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(async () => result)
        }))
      })),
      innerJoin: vi.fn(() => ({
        where: vi.fn(() => ({
          groupBy: vi.fn(async () => result)
        }))
      })),
      where: vi.fn(async () => result)
    }))
  };
}

describe('useClientEmailFolderOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReset();
    mockDb.insert.mockReset();
    mockDb.update.mockReset();
    mockDb.delete.mockReset();
    mockDb.transaction.mockReset();
  });

  it('returns all folder operations', () => {
    const { result } = renderHook(() => useClientEmailFolderOperations());
    expect(result.current.fetchFolders).toBeInstanceOf(Function);
    expect(result.current.createFolder).toBeInstanceOf(Function);
    expect(result.current.renameFolder).toBeInstanceOf(Function);
    expect(result.current.deleteFolder).toBeInstanceOf(Function);
    expect(result.current.moveFolder).toBeInstanceOf(Function);
    expect(result.current.initializeSystemFolders).toBeInstanceOf(Function);
    expect(result.current.getFolderByType).toBeInstanceOf(Function);
  });

  it('fetchFolders returns mapped folders with unread counts', async () => {
    const folderRows = [
      { id: 'f1', encryptedName: 'Inbox', parentId: null },
      { id: 'f2', encryptedName: 'Sent', parentId: null },
      { id: 'f3', encryptedName: 'Custom Folder', parentId: 'f1' }
    ];
    const unreadRows = [{ parentId: 'f1', unreadCount: 5 }];

    mockDb.select
      .mockReturnValueOnce(mockQueryChain(folderRows))
      .mockReturnValueOnce(mockQueryChain(unreadRows));

    const { result } = renderHook(() => useClientEmailFolderOperations());
    const folders = await result.current.fetchFolders();

    expect(folders).toHaveLength(3);
    expect(folders[0]).toEqual({
      id: 'f1',
      name: 'Inbox',
      folderType: 'inbox',
      parentId: null,
      unreadCount: 5
    });
    expect(folders[1]).toEqual({
      id: 'f2',
      name: 'Sent',
      folderType: 'sent',
      parentId: null,
      unreadCount: 0
    });
    expect(folders[2]).toEqual({
      id: 'f3',
      name: 'Custom Folder',
      folderType: 'custom',
      parentId: 'f1',
      unreadCount: 0
    });
  });

  it('fetchFolders handles null encryptedName', async () => {
    mockDb.select
      .mockReturnValueOnce(
        mockQueryChain([{ id: 'f1', encryptedName: null, parentId: null }])
      )
      .mockReturnValueOnce(mockQueryChain([]));

    const { result } = renderHook(() => useClientEmailFolderOperations());
    const folders = await result.current.fetchFolders();

    expect(folders[0].name).toBe('Unnamed Folder');
    expect(folders[0].folderType).toBe('custom');
  });

  it('deriveFolderType maps known folder names', async () => {
    const names = ['Inbox', 'Sent', 'Drafts', 'Trash', 'Spam'];
    const expectedTypes = ['inbox', 'sent', 'drafts', 'trash', 'spam'];

    for (let i = 0; i < names.length; i++) {
      mockDb.select
        .mockReturnValueOnce(
          mockQueryChain([
            { id: `f${i}`, encryptedName: names[i], parentId: null }
          ])
        )
        .mockReturnValueOnce(mockQueryChain([]));

      const { result } = renderHook(() => useClientEmailFolderOperations());
      const folders = await result.current.fetchFolders();
      expect(folders[0].folderType).toBe(expectedTypes[i]);
    }
  });

  it('createFolder creates a folder with parent link', async () => {
    const txInsert = vi.fn(() => ({ values: vi.fn() }));
    mockDb.transaction.mockImplementation(
      async (fn: (...args: never) => unknown) => {
        await fn({ insert: txInsert });
      }
    );

    const { result } = renderHook(() => useClientEmailFolderOperations());
    const folder = await result.current.createFolder('Test Folder', 'parent-1');

    expect(folder.name).toBe('Test Folder');
    expect(folder.folderType).toBe('custom');
    expect(folder.parentId).toBe('parent-1');
    expect(folder.unreadCount).toBe(0);
    expect(txInsert).toHaveBeenCalledTimes(2);
  });

  it('createFolder creates a folder without parent link', async () => {
    const txInsert = vi.fn(() => ({ values: vi.fn() }));
    mockDb.transaction.mockImplementation(
      async (fn: (...args: never) => unknown) => {
        await fn({ insert: txInsert });
      }
    );

    const { result } = renderHook(() => useClientEmailFolderOperations());
    const folder = await result.current.createFolder('Root Folder');

    expect(folder.parentId).toBeNull();
    expect(txInsert).toHaveBeenCalledTimes(1);
  });

  it('renameFolder updates the folder name', async () => {
    const mockWhere = vi.fn();
    mockDb.update.mockReturnValue({
      set: vi.fn(() => ({ where: mockWhere }))
    });

    const { result } = renderHook(() => useClientEmailFolderOperations());
    await result.current.renameFolder('f1', 'New Name');

    expect(mockDb.update).toHaveBeenCalled();
  });

  it('deleteFolder removes links and registry entry', async () => {
    const txDelete = vi.fn(() => ({ where: vi.fn() }));
    mockDb.transaction.mockImplementation(
      async (fn: (...args: never) => unknown) => {
        await fn({ delete: txDelete });
      }
    );

    const { result } = renderHook(() => useClientEmailFolderOperations());
    await result.current.deleteFolder('f1');

    expect(txDelete).toHaveBeenCalledTimes(3);
  });

  it('moveFolder updates parent link', async () => {
    const txDelete = vi.fn(() => ({ where: vi.fn() }));
    const txInsert = vi.fn(() => ({ values: vi.fn() }));
    mockDb.transaction.mockImplementation(
      async (fn: (...args: never) => unknown) => {
        await fn({ delete: txDelete, insert: txInsert });
      }
    );

    const { result } = renderHook(() => useClientEmailFolderOperations());
    await result.current.moveFolder('f1', 'new-parent');

    expect(txDelete).toHaveBeenCalledTimes(1);
    expect(txInsert).toHaveBeenCalledTimes(1);
  });

  it('moveFolder to null parent removes link without creating new one', async () => {
    const txDelete = vi.fn(() => ({ where: vi.fn() }));
    const txInsert = vi.fn(() => ({ values: vi.fn() }));
    mockDb.transaction.mockImplementation(
      async (fn: (...args: never) => unknown) => {
        await fn({ delete: txDelete, insert: txInsert });
      }
    );

    const { result } = renderHook(() => useClientEmailFolderOperations());
    await result.current.moveFolder('f1', null);

    expect(txDelete).toHaveBeenCalledTimes(1);
    expect(txInsert).not.toHaveBeenCalled();
  });

  it('getFolderByType returns matching folder', async () => {
    mockDb.select.mockReturnValueOnce(
      mockQueryChain([{ id: 'inbox-id', encryptedName: 'Inbox' }])
    );

    const { result } = renderHook(() => useClientEmailFolderOperations());
    const folder = await result.current.getFolderByType('inbox');

    expect(folder).toEqual({
      id: 'inbox-id',
      name: 'Inbox',
      folderType: 'inbox',
      parentId: null,
      unreadCount: 0
    });
  });

  it('getFolderByType returns null when no match', async () => {
    mockDb.select.mockReturnValueOnce(mockQueryChain([]));

    const { result } = renderHook(() => useClientEmailFolderOperations());
    const folder = await result.current.getFolderByType('drafts');

    expect(folder).toBeNull();
  });

  it('initializeSystemFolders creates missing folders', async () => {
    const txInsert = vi.fn(() => ({ values: vi.fn() }));
    mockDb.transaction.mockImplementation(
      async (fn: (...args: never) => unknown) => {
        // Return empty array to indicate folder doesn't exist
        const mockTx = {
          select: () => ({
            from: () => ({
              where: async () => []
            })
          }),
          insert: () => ({ values: txInsert })
        };
        await fn(mockTx);
      }
    );

    const { result } = renderHook(() => useClientEmailFolderOperations());
    await result.current.initializeSystemFolders();

    // Should insert for each system folder type
    expect(txInsert).toHaveBeenCalled();
  });

  it('initializeSystemFolders skips existing folders', async () => {
    const txInsert = vi.fn(() => ({ values: vi.fn() }));
    mockDb.transaction.mockImplementation(
      async (fn: (...args: never) => unknown) => {
        const mockTx = {
          select: () => ({
            from: () => ({
              where: async () => [{ id: 'existing-id' }]
            })
          }),
          insert: () => ({ values: txInsert })
        };
        await fn(mockTx);
      }
    );

    const { result } = renderHook(() => useClientEmailFolderOperations());
    await result.current.initializeSystemFolders();

    expect(txInsert).not.toHaveBeenCalled();
  });
});
