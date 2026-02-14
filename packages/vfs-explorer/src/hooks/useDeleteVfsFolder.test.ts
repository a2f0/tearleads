import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDatabase, createWrapper } from '../test/testUtils';
import { useDeleteVfsFolder } from './useDeleteVfsFolder';

interface DeleteTxOptions {
  objectType: string | null;
}

function createDeleteTx({ objectType }: DeleteTxOptions) {
  const deleteWhere = vi.fn(async () => undefined);
  const limit = vi.fn(async () =>
    objectType ? [{ objectType }] : ([] as Array<{ objectType: string }>)
  );

  const tx = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit
        }))
      }))
    })),
    delete: vi.fn(() => ({
      where: deleteWhere
    }))
  };

  return { tx, deleteWhere, limit };
}

describe('useDeleteVfsFolder', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
  });

  it('deletes a folder only after folder-type guardrail passes', async () => {
    const { tx, deleteWhere } = createDeleteTx({ objectType: 'folder' });
    mockDb.transaction = vi.fn(async (callback) => {
      await callback(tx);
    });

    const wrapper = createWrapper({ database: mockDb });
    const { result } = renderHook(() => useDeleteVfsFolder(), { wrapper });

    await act(async () => {
      await result.current.deleteFolder('folder-1');
    });

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
    expect(result.current.isDeleting).toBe(false);
  });

  it('rejects when folder ID is missing', async () => {
    const wrapper = createWrapper({ database: mockDb });
    const { result } = renderHook(() => useDeleteVfsFolder(), { wrapper });

    await expect(
      act(async () => {
        await result.current.deleteFolder('');
      })
    ).rejects.toThrow('Folder ID is required');
  });

  it('fails closed when folder does not exist', async () => {
    const { tx, deleteWhere } = createDeleteTx({ objectType: null });
    mockDb.transaction = vi.fn(async (callback) => {
      await callback(tx);
    });

    const wrapper = createWrapper({ database: mockDb });
    const { result } = renderHook(() => useDeleteVfsFolder(), { wrapper });

    let caughtError: Error | undefined;
    await act(async () => {
      try {
        await result.current.deleteFolder('missing-folder');
      } catch (error) {
        caughtError = error as Error;
      }
    });

    expect(caughtError?.message).toBe('Folder not found');
    expect(deleteWhere).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Folder not found');
    expect(result.current.isDeleting).toBe(false);
  });

  it('fails closed when candidate item is not a folder', async () => {
    const { tx, deleteWhere } = createDeleteTx({ objectType: 'note' });
    mockDb.transaction = vi.fn(async (callback) => {
      await callback(tx);
    });

    const wrapper = createWrapper({ database: mockDb });
    const { result } = renderHook(() => useDeleteVfsFolder(), { wrapper });

    let caughtError: Error | undefined;
    await act(async () => {
      try {
        await result.current.deleteFolder('item-1');
      } catch (error) {
        caughtError = error as Error;
      }
    });

    expect(caughtError?.message).toBe('Refusing to delete non-folder VFS item');
    expect(deleteWhere).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Refusing to delete non-folder VFS item');
    expect(result.current.isDeleting).toBe(false);
  });

  it('surfaces transaction errors', async () => {
    mockDb.transaction = vi.fn(async () => {
      throw new Error('Delete failed');
    });

    const wrapper = createWrapper({ database: mockDb });
    const { result } = renderHook(() => useDeleteVfsFolder(), { wrapper });

    let caughtError: Error | undefined;
    await act(async () => {
      try {
        await result.current.deleteFolder('folder-1');
      } catch (error) {
        caughtError = error as Error;
      }
    });

    expect(caughtError?.message).toBe('Delete failed');
    expect(result.current.error).toBe('Delete failed');
    expect(result.current.isDeleting).toBe(false);
  });
});
