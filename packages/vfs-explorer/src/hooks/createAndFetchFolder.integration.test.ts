import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VFS_ROOT_ID } from '../constants';
import {
  createMockDatabase,
  createMockDatabaseState,
  createWrapper
} from '../test/testUtils';
import { useCreateVfsFolder } from './useCreateVfsFolder';
import { useVfsFolders } from './useVfsFolders';

vi.stubGlobal('crypto', {
  randomUUID: vi.fn(() => 'new-folder-uuid')
});

describe('VFS Folder Integration: Create and Fetch', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;
  let mockInsert: ReturnType<typeof vi.fn>;
  let mockTransaction: ReturnType<typeof vi.fn>;
  let insertedData: {
    registry: Record<string, unknown> | null;
    folder: Record<string, unknown> | null;
    link: Record<string, unknown> | null;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    insertedData = {
      registry: null,
      folder: null,
      link: null
    };

    let insertCount = 0;
    mockInsert = vi.fn(() => ({
      values: vi.fn((data) => {
        if (insertCount === 0) {
          insertedData.registry = data;
        } else if (insertCount === 1) {
          insertedData.folder = data;
        } else if (insertCount === 2) {
          insertedData.link = data;
        }
        insertCount++;
        return Promise.resolve(undefined);
      })
    }));

    // Mock tx.select for VFS root check - always return root exists
    const mockTxSelect = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([{ id: VFS_ROOT_ID }])
        }))
      }))
    }));

    mockTransaction = vi.fn(async (callback) => {
      insertCount = 0;
      await callback({
        insert: mockInsert,
        select: mockTxSelect
      });
    });

    mockDb = {
      ...createMockDatabase(),
      insert: mockInsert,
      transaction: mockTransaction
    };
  });

  it('creates a folder and verifies it appears in the folder list', async () => {
    const folderName = 'My New Folder';

    const wrapper = createWrapper({
      database: mockDb,
      databaseState: createMockDatabaseState(),
      auth: { isLoggedIn: vi.fn(() => false) }
    });

    const { result: createResult } = renderHook(() => useCreateVfsFolder(), {
      wrapper
    });

    let createdFolder: { id: string; name: string } | undefined;

    await act(async () => {
      createdFolder = await createResult.current.createFolder(folderName);
    });

    expect(createdFolder).toEqual({
      id: 'new-folder-uuid',
      name: folderName
    });

    expect(insertedData.registry).toMatchObject({
      id: 'new-folder-uuid',
      objectType: 'folder'
    });

    expect(insertedData.folder).toMatchObject({
      id: 'new-folder-uuid',
      encryptedName: folderName
    });

    expect(insertedData.link).toMatchObject({
      parentId: VFS_ROOT_ID,
      childId: 'new-folder-uuid'
    });

    mockDb.where
      .mockResolvedValueOnce([
        {
          id: 'new-folder-uuid',
          name: folderName,
          createdAt: Date.now()
        }
      ])
      .mockResolvedValueOnce([
        { childId: 'new-folder-uuid', parentId: VFS_ROOT_ID }
      ])
      .mockResolvedValueOnce([]);

    const { result: foldersResult } = renderHook(() => useVfsFolders(), {
      wrapper
    });

    await waitFor(() => {
      expect(foldersResult.current.hasFetched).toBe(true);
    });

    expect(foldersResult.current.folders).toHaveLength(1);
    expect(foldersResult.current.folders[0]).toMatchObject({
      id: 'new-folder-uuid',
      name: folderName,
      parentId: VFS_ROOT_ID
    });
  });

  it('creates a nested folder under an existing parent', async () => {
    const parentFolderId = 'existing-parent-id';
    const childFolderName = 'Child Folder';

    const wrapper = createWrapper({
      database: mockDb,
      databaseState: createMockDatabaseState(),
      auth: { isLoggedIn: vi.fn(() => false) }
    });

    const { result: createResult } = renderHook(() => useCreateVfsFolder(), {
      wrapper
    });

    await act(async () => {
      await createResult.current.createFolder(childFolderName, parentFolderId);
    });

    expect(insertedData.link).toMatchObject({
      parentId: parentFolderId,
      childId: 'new-folder-uuid'
    });

    mockDb.where
      .mockResolvedValueOnce([
        { id: parentFolderId, name: 'Parent Folder', createdAt: Date.now() },
        { id: 'new-folder-uuid', name: childFolderName, createdAt: Date.now() }
      ])
      .mockResolvedValueOnce([
        { childId: parentFolderId, parentId: VFS_ROOT_ID },
        { childId: 'new-folder-uuid', parentId: parentFolderId }
      ])
      .mockResolvedValueOnce([{ parentId: parentFolderId }]);

    const { result: foldersResult } = renderHook(() => useVfsFolders(), {
      wrapper
    });

    await waitFor(() => {
      expect(foldersResult.current.hasFetched).toBe(true);
    });

    expect(foldersResult.current.folders).toHaveLength(1);
    const parentFolder = foldersResult.current.folders[0];
    expect(parentFolder?.name).toBe('Parent Folder');
    expect(parentFolder?.children).toHaveLength(1);
    expect(parentFolder?.children?.[0]).toMatchObject({
      id: 'new-folder-uuid',
      name: childFolderName,
      parentId: parentFolderId
    });
  });

  it('creates folder with encrypted session key when logged in', async () => {
    const folderName = 'Encrypted Folder';
    const mockWrapSessionKey = vi.fn(async () => 'wrapped-key-123');

    const wrapper = createWrapper({
      database: mockDb,
      databaseState: createMockDatabaseState(),
      auth: {
        isLoggedIn: vi.fn(() => true),
        readStoredAuth: vi.fn(() => ({ user: { id: 'user-123' } }))
      },
      vfsKeys: {
        generateSessionKey: vi.fn(() => new Uint8Array(32)),
        wrapSessionKey: mockWrapSessionKey
      }
    });

    const { result: createResult } = renderHook(() => useCreateVfsFolder(), {
      wrapper
    });

    await act(async () => {
      await createResult.current.createFolder(folderName);
    });

    expect(mockWrapSessionKey).toHaveBeenCalled();
    expect(insertedData.registry).toMatchObject({
      id: 'new-folder-uuid',
      objectType: 'folder',
      ownerId: 'user-123',
      encryptedSessionKey: 'wrapped-key-123'
    });
  });

  it('handles folder creation failure gracefully', async () => {
    mockTransaction.mockRejectedValueOnce(new Error('Database write failed'));

    const wrapper = createWrapper({
      database: mockDb,
      databaseState: createMockDatabaseState()
    });

    const { result: createResult } = renderHook(() => useCreateVfsFolder(), {
      wrapper
    });

    await act(async () => {
      try {
        await createResult.current.createFolder('Failed Folder');
      } catch {
        // Expected to throw
      }
    });

    expect(createResult.current.error).toBe('Database write failed');
    expect(createResult.current.isCreating).toBe(false);
  });

  it('creates multiple folders and verifies they all appear', async () => {
    const wrapper = createWrapper({
      database: mockDb,
      databaseState: createMockDatabaseState(),
      auth: { isLoggedIn: vi.fn(() => false) }
    });

    const { result: createResult } = renderHook(() => useCreateVfsFolder(), {
      wrapper
    });

    let uuidCounter = 0;
    vi.mocked(crypto.randomUUID).mockImplementation(
      () =>
        `folder-${++uuidCounter}-0000-0000-0000-000000000000` as `${string}-${string}-${string}-${string}-${string}`
    );

    await act(async () => {
      await createResult.current.createFolder('Folder A');
    });

    await act(async () => {
      await createResult.current.createFolder('Folder B');
    });

    await act(async () => {
      await createResult.current.createFolder('Folder C');
    });

    mockDb.where
      .mockResolvedValueOnce([
        {
          id: 'folder-1-0000-0000-0000-000000000000',
          name: 'Folder A',
          createdAt: Date.now()
        },
        {
          id: 'folder-2-0000-0000-0000-000000000000',
          name: 'Folder B',
          createdAt: Date.now()
        },
        {
          id: 'folder-3-0000-0000-0000-000000000000',
          name: 'Folder C',
          createdAt: Date.now()
        }
      ])
      .mockResolvedValueOnce([
        {
          childId: 'folder-1-0000-0000-0000-000000000000',
          parentId: VFS_ROOT_ID
        },
        {
          childId: 'folder-2-0000-0000-0000-000000000000',
          parentId: VFS_ROOT_ID
        },
        {
          childId: 'folder-3-0000-0000-0000-000000000000',
          parentId: VFS_ROOT_ID
        }
      ])
      .mockResolvedValueOnce([]);

    const { result: foldersResult } = renderHook(() => useVfsFolders(), {
      wrapper
    });

    await waitFor(() => {
      expect(foldersResult.current.hasFetched).toBe(true);
    });

    expect(foldersResult.current.folders).toHaveLength(3);
    const folderNames = foldersResult.current.folders.map((f) => f.name);
    expect(folderNames).toContain('Folder A');
    expect(folderNames).toContain('Folder B');
    expect(folderNames).toContain('Folder C');
  });
});
