import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the context
vi.mock('../context', () => ({
  useVfsExplorerContext: vi.fn(() => ({
    getDatabase: vi.fn(),
    vfsKeys: {
      generateSessionKey: vi.fn(() => new Uint8Array([1, 2, 3])),
      wrapSessionKey: vi.fn(async () => 'wrapped-key')
    },
    auth: {
      isLoggedIn: vi.fn(() => true)
    }
  }))
}));

import { useVfsExplorerContext } from '../context';
import { useCopyVfsItem } from './useCopyVfsItem';

describe('useCopyVfsItem', () => {
  const mockInsert = vi.fn(() => ({
    values: vi.fn().mockResolvedValue(undefined)
  }));

  const mockFindFirst = vi.fn();

  const mockDb = {
    query: {
      vfsLinks: {
        findFirst: mockFindFirst
      }
    },
    insert: mockInsert
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFirst.mockResolvedValue(null);
    vi.mocked(useVfsExplorerContext).mockReturnValue({
      getDatabase: (() => mockDb) as never,
      vfsKeys: {
        generateSessionKey: vi.fn(() => new Uint8Array([1, 2, 3])),
        wrapSessionKey: vi.fn(async () => 'wrapped-key')
      },
      auth: {
        isLoggedIn: vi.fn(() => true),
        readStoredAuth: vi.fn(() => ({ user: { id: 'user-1' } }))
      },
      databaseState: {
        isUnlocked: true,
        isLoading: false,
        currentInstanceId: 'test-instance'
      },
      ui: {} as never,
      featureFlags: { getFeatureFlagValue: vi.fn() },
      vfsApi: { register: vi.fn() }
    });
  });

  it('initializes with default state', () => {
    const { result } = renderHook(() => useCopyVfsItem());

    expect(result.current.isCopying).toBe(false);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.copyItem).toBe('function');
  });

  it('throws error when itemId is missing', async () => {
    const { result } = renderHook(() => useCopyVfsItem());

    await expect(result.current.copyItem('', 'folder-1')).rejects.toThrow(
      'Item ID and target folder ID are required'
    );
  });

  it('throws error when targetFolderId is missing', async () => {
    const { result } = renderHook(() => useCopyVfsItem());

    await expect(result.current.copyItem('item-1', '')).rejects.toThrow(
      'Item ID and target folder ID are required'
    );
  });

  it('skips copy if link already exists', async () => {
    mockFindFirst.mockResolvedValue({ id: 'existing-link' });

    const { result } = renderHook(() => useCopyVfsItem());

    await act(async () => {
      await result.current.copyItem('item-1', 'folder-1');
    });

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('creates a new link when copying item', async () => {
    mockFindFirst.mockResolvedValue(null);
    const mockValues = vi.fn().mockResolvedValue(undefined);
    mockInsert.mockReturnValue({ values: mockValues });

    const { result } = renderHook(() => useCopyVfsItem());

    await act(async () => {
      await result.current.copyItem('item-1', 'folder-1');
    });

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: 'folder-1',
          childId: 'item-1',
          wrappedSessionKey: 'wrapped-key'
        })
      );
    });
  });

  it('sets isCopying during operation', async () => {
    mockFindFirst.mockResolvedValue(null);
    let resolveInsert: () => void;
    const insertPromise = new Promise<void>((resolve) => {
      resolveInsert = resolve;
    });
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue(insertPromise)
    });

    const { result } = renderHook(() => useCopyVfsItem());

    let copyPromise: Promise<void>;
    act(() => {
      copyPromise = result.current.copyItem('item-1', 'folder-1');
    });

    await waitFor(() => {
      expect(result.current.isCopying).toBe(true);
    });

    await act(async () => {
      resolveInsert?.();
      await copyPromise;
    });

    await waitFor(() => {
      expect(result.current.isCopying).toBe(false);
    });
  });

  it('sets error on failure', async () => {
    mockFindFirst.mockRejectedValue(new Error('Database error'));

    const { result } = renderHook(() => useCopyVfsItem());

    await act(async () => {
      await expect(
        result.current.copyItem('item-1', 'folder-1')
      ).rejects.toThrow('Database error');
    });

    expect(result.current.error).toBe('Database error');
  });
});
