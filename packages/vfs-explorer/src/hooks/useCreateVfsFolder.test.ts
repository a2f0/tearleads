import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VFS_ROOT_ID } from '../constants';
import { createMockDatabase, createWrapper } from '../test/testUtils';
import { useCreateVfsFolder } from './useCreateVfsFolder';

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
  randomUUID: vi.fn(() => 'test-uuid-1234')
});

describe('useCreateVfsFolder', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;
  let mockInsert: ReturnType<typeof vi.fn>;
  let mockTransaction: ReturnType<typeof vi.fn>;
  let mockTxSelect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockInsert = vi.fn(() => ({
      values: vi.fn().mockResolvedValue(undefined)
    }));

    // Default mock for tx.select - VFS root exists
    mockTxSelect = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([{ id: VFS_ROOT_ID }])
        }))
      }))
    }));

    mockTransaction = vi.fn(async (callback) => {
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

  it('returns initial state', () => {
    const wrapper = createWrapper({ database: mockDb });
    const { result } = renderHook(() => useCreateVfsFolder(), { wrapper });

    expect(result.current.isCreating).toBe(false);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.createFolder).toBe('function');
  });

  it('creates folder successfully', async () => {
    const wrapper = createWrapper({ database: mockDb });
    const { result } = renderHook(() => useCreateVfsFolder(), { wrapper });

    let folderResult: { id: string; name: string } | undefined;

    await act(async () => {
      folderResult = await result.current.createFolder('Test Folder');
    });

    expect(folderResult).toEqual({
      id: 'test-uuid-1234',
      name: 'Test Folder'
    });
    expect(result.current.isCreating).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('throws error for empty name', async () => {
    const wrapper = createWrapper({ database: mockDb });
    const { result } = renderHook(() => useCreateVfsFolder(), { wrapper });

    await expect(
      act(async () => {
        await result.current.createFolder('');
      })
    ).rejects.toThrow('Folder name is required');
  });

  it('throws error for whitespace-only name', async () => {
    const wrapper = createWrapper({ database: mockDb });
    const { result } = renderHook(() => useCreateVfsFolder(), { wrapper });

    await expect(
      act(async () => {
        await result.current.createFolder('   ');
      })
    ).rejects.toThrow('Folder name is required');
  });

  it('trims folder name', async () => {
    const wrapper = createWrapper({ database: mockDb });
    const { result } = renderHook(() => useCreateVfsFolder(), { wrapper });

    let folderResult: { id: string; name: string } | undefined;

    await act(async () => {
      folderResult = await result.current.createFolder('  Trimmed Name  ');
    });

    expect(folderResult?.name).toBe('Trimmed Name');
  });

  it('creates folder with parent link when parentId is provided and logged in', async () => {
    const wrapper = createWrapper({
      database: mockDb,
      auth: { isLoggedIn: vi.fn(() => true) }
    });
    const { result } = renderHook(() => useCreateVfsFolder(), { wrapper });

    await act(async () => {
      await result.current.createFolder('Child Folder', 'parent-folder-id');
    });

    // Should have 3 inserts: registry, folders, links
    expect(mockInsert).toHaveBeenCalledTimes(3);
  });

  it('creates folder with link to VFS root when not logged in and no parent specified', async () => {
    const wrapper = createWrapper({
      database: mockDb,
      auth: { isLoggedIn: vi.fn(() => false) }
    });
    const { result } = renderHook(() => useCreateVfsFolder(), { wrapper });

    await act(async () => {
      await result.current.createFolder('Root Folder');
    });

    // Should have 3 inserts: registry, folders, links (always creates link now)
    expect(mockInsert).toHaveBeenCalledTimes(3);
  });

  it('still creates folder when session key wrapping fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mockWrapSessionKey = vi
      .fn()
      .mockRejectedValueOnce(new Error('VFS error'));

    const wrapper = createWrapper({
      database: mockDb,
      auth: { isLoggedIn: vi.fn(() => true) },
      vfsKeys: { wrapSessionKey: mockWrapSessionKey }
    });
    const { result } = renderHook(() => useCreateVfsFolder(), { wrapper });

    let folderResult: { id: string; name: string } | undefined;

    await act(async () => {
      folderResult = await result.current.createFolder('Offline Folder');
    });

    expect(folderResult?.name).toBe('Offline Folder');
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to wrap folder session key:',
      expect.any(Error)
    );

    warnSpy.mockRestore();
  });

  it('sets error state on failure', async () => {
    mockTransaction.mockImplementationOnce(async () => {
      throw new Error('Database error');
    });

    const wrapper = createWrapper({ database: mockDb });
    const { result } = renderHook(() => useCreateVfsFolder(), { wrapper });

    let caughtError: Error | undefined;

    await act(async () => {
      try {
        await result.current.createFolder('Failed Folder');
      } catch (err) {
        caughtError = err as Error;
      }
    });

    expect(caughtError?.message).toBe('Database error');
    expect(result.current.error).toBe('Database error');
    expect(result.current.isCreating).toBe(false);
  });

  it('uses unknown for ownerId when user is not available', async () => {
    const wrapper = createWrapper({
      database: mockDb,
      auth: {
        isLoggedIn: vi.fn(() => false),
        readStoredAuth: vi.fn(() => ({ user: null }))
      }
    });
    const { result } = renderHook(() => useCreateVfsFolder(), { wrapper });

    await act(async () => {
      await result.current.createFolder('Anonymous Folder');
    });

    expect(result.current.error).toBeNull();
  });

  it('creates VFS root if it does not exist when creating folder without parent', async () => {
    let insertCount = 0;
    const insertedIds: string[] = [];
    const localMockInsert = vi.fn(() => ({
      values: vi.fn((val) => {
        insertCount++;
        if (val.id) insertedIds.push(val.id);
        return Promise.resolve();
      })
    }));

    const localMockSelect = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([]) // VFS root does not exist
        }))
      }))
    }));

    mockTransaction.mockImplementationOnce(async (callback) => {
      await callback({
        insert: localMockInsert,
        select: localMockSelect
      });
    });

    const wrapper = createWrapper({
      database: mockDb,
      auth: { isLoggedIn: vi.fn(() => false) }
    });
    const { result } = renderHook(() => useCreateVfsFolder(), { wrapper });

    await act(async () => {
      await result.current.createFolder('New Folder');
    });

    expect(result.current.error).toBeNull();

    // Should have inserted: vfs_registry (root), vfs_folders (root),
    // vfs_registry (new folder), vfs_folders (new folder), vfs_links
    expect(insertCount).toBe(5);

    // First two inserts should be for VFS root
    expect(insertedIds[0]).toBe(VFS_ROOT_ID);
    expect(insertedIds[1]).toBe(VFS_ROOT_ID);

    // Third and fourth should be for the new folder
    expect(insertedIds[2]).toBe('test-uuid-1234');
    expect(insertedIds[3]).toBe('test-uuid-1234');
  });

  it('does not create VFS root if it already exists', async () => {
    let insertCount = 0;
    const insertedIds: string[] = [];
    const localMockInsert = vi.fn(() => ({
      values: vi.fn((val) => {
        insertCount++;
        if (val.id) insertedIds.push(val.id);
        return Promise.resolve();
      })
    }));

    const localMockSelect = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([{ id: VFS_ROOT_ID }]) // VFS root exists
        }))
      }))
    }));

    mockTransaction.mockImplementationOnce(async (callback) => {
      await callback({
        insert: localMockInsert,
        select: localMockSelect
      });
    });

    const wrapper = createWrapper({
      database: mockDb,
      auth: { isLoggedIn: vi.fn(() => false) }
    });
    const { result } = renderHook(() => useCreateVfsFolder(), { wrapper });

    await act(async () => {
      await result.current.createFolder('New Folder');
    });

    expect(result.current.error).toBeNull();

    // Should have inserted only: vfs_registry (new folder), vfs_folders (new folder), vfs_links
    expect(insertCount).toBe(3);

    // First insert should be the new folder, not the VFS root
    expect(insertedIds[0]).toBe('test-uuid-1234');
  });

  it('does not check for VFS root when creating folder with explicit parent', async () => {
    let insertCount = 0;
    const localMockInsert = vi.fn(() => ({
      values: vi.fn(() => {
        insertCount++;
        return Promise.resolve();
      })
    }));

    const localMockSelect = vi.fn();

    mockTransaction.mockImplementationOnce(async (callback) => {
      await callback({
        insert: localMockInsert,
        select: localMockSelect
      });
    });

    const wrapper = createWrapper({
      database: mockDb,
      auth: { isLoggedIn: vi.fn(() => false) }
    });
    const { result } = renderHook(() => useCreateVfsFolder(), { wrapper });

    await act(async () => {
      await result.current.createFolder('New Folder', 'explicit-parent-id');
    });

    expect(result.current.error).toBeNull();

    // Should NOT have called select (no VFS root check needed)
    expect(localMockSelect).not.toHaveBeenCalled();

    // Should have inserted only: vfs_registry, vfs_folders, vfs_links
    expect(insertCount).toBe(3);
  });
});
