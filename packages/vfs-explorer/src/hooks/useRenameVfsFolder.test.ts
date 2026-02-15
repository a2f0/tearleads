import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDatabase, createWrapper } from '../test/testUtils';
import { useRenameVfsFolder } from './useRenameVfsFolder';

describe('useRenameVfsFolder', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;
  let setPayloads: Array<Record<string, unknown>>;
  let updateCallCount = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    setPayloads = [];
    updateCallCount = 0;
    mockDb = createMockDatabase();

    mockDb.transaction = vi.fn(async (callback) => {
      await callback({
        update: vi.fn(() => {
          updateCallCount++;
          return {
            set: vi.fn((payload) => {
              if (typeof payload === 'object' && payload !== null) {
                setPayloads.push(payload as Record<string, unknown>);
              }
              return {
                where: vi.fn(async () => undefined)
              };
            })
          };
        })
      });
    });
  });

  it('renames folder in canonical metadata table', async () => {
    const wrapper = createWrapper({ database: mockDb });
    const { result } = renderHook(() => useRenameVfsFolder(), { wrapper });

    await act(async () => {
      await result.current.renameFolder('folder-1', '  New Name  ');
    });

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(updateCallCount).toBe(1);
    expect(setPayloads[0]?.['encryptedName']).toBe('New Name');
    expect(result.current.error).toBeNull();
    expect(result.current.isRenaming).toBe(false);
  });

  it('throws for empty folder name', async () => {
    const wrapper = createWrapper({ database: mockDb });
    const { result } = renderHook(() => useRenameVfsFolder(), { wrapper });

    await expect(
      act(async () => {
        await result.current.renameFolder('folder-1', '   ');
      })
    ).rejects.toThrow('Folder name is required');
  });

  it('throws for missing folder ID', async () => {
    const wrapper = createWrapper({ database: mockDb });
    const { result } = renderHook(() => useRenameVfsFolder(), { wrapper });

    await expect(
      act(async () => {
        await result.current.renameFolder('', 'Valid Name');
      })
    ).rejects.toThrow('Folder ID is required');
  });

  it('sets error state when transaction fails', async () => {
    mockDb.transaction = vi.fn(async () => {
      throw new Error('Rename failed');
    });

    const wrapper = createWrapper({ database: mockDb });
    const { result } = renderHook(() => useRenameVfsFolder(), { wrapper });

    let caughtError: Error | undefined;
    await act(async () => {
      try {
        await result.current.renameFolder('folder-1', 'New Name');
      } catch (err) {
        caughtError = err as Error;
      }
    });

    expect(caughtError?.message).toBe('Rename failed');
    expect(result.current.error).toBe('Rename failed');
    expect(result.current.isRenaming).toBe(false);
  });
});
