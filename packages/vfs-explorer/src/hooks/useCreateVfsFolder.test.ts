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

  beforeEach(() => {
    vi.clearAllMocks();

    mockInsert = vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined)
      }))
    }));

    mockTransaction = vi.fn(async (callback) => {
      await callback({
        insert: mockInsert
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

    // Should have 2 inserts: registry, links
    expect(mockInsert).toHaveBeenCalledTimes(2);
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

    // Should have 3 inserts: vfs_registry (root), vfs_registry (new folder), vfs_links
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

  it('inserts VFS root with onConflictDoNothing when creating folder without parent', async () => {
    let insertCount = 0;
    const insertedIds: string[] = [];
    const insertedValues: Array<Record<string, unknown>> = [];
    const localMockInsert = vi.fn(() => ({
      values: vi.fn((val) => {
        insertCount++;
        if (val.id) insertedIds.push(val.id);
        if (typeof val === 'object' && val !== null) {
          insertedValues.push(val as Record<string, unknown>);
        }
        return {
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined)
        };
      })
    }));

    mockTransaction.mockImplementationOnce(async (callback) => {
      await callback({
        insert: localMockInsert
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

    // Should have inserted: vfs_registry (root), vfs_registry (new folder), vfs_links
    expect(insertCount).toBe(3);

    // First insert should be for VFS root (with onConflictDoNothing)
    expect(insertedIds[0]).toBe(VFS_ROOT_ID);
    expect(insertedValues[0]?.['encryptedName']).toBe('VFS Root');

    // Second insert should be for the new folder
    expect(insertedIds[1]).toBe('test-uuid-1234');
    expect(insertedValues[1]?.['encryptedName']).toBe('New Folder');
  });

  it('does not insert VFS root when creating folder with explicit parent', async () => {
    let insertCount = 0;
    const insertedIds: string[] = [];
    const insertedValues: Array<Record<string, unknown>> = [];
    const localMockInsert = vi.fn(() => ({
      values: vi.fn((val) => {
        insertCount++;
        if (val.id) insertedIds.push(val.id);
        if (typeof val === 'object' && val !== null) {
          insertedValues.push(val as Record<string, unknown>);
        }
        return {
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined)
        };
      })
    }));

    mockTransaction.mockImplementationOnce(async (callback) => {
      await callback({
        insert: localMockInsert
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

    // Should have inserted only: vfs_registry (new folder), vfs_links
    expect(insertCount).toBe(2);

    // First insert should be the new folder, not the VFS root
    expect(insertedIds[0]).toBe('test-uuid-1234');
    expect(insertedValues[0]?.['encryptedName']).toBe('New Folder');
  });
});
