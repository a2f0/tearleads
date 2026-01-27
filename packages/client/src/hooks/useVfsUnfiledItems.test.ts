import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock database select builder
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockSelect = vi.fn(() => ({
  from: mockFrom
}));

const mockDb = {
  select: mockSelect
};

// Mock database
vi.mock('@/db', () => ({
  getDatabase: vi.fn(() => mockDb)
}));

// Mock database context
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: vi.fn()
}));

// Mock schema
vi.mock('@/db/schema', () => ({
  contacts: { id: 'id', firstName: 'first_name', lastName: 'last_name' },
  files: { id: 'id', name: 'name' },
  notes: { id: 'id', title: 'title' },
  vfsFolders: { id: 'id', encryptedName: 'encrypted_name' },
  vfsLinks: { childId: 'child_id' },
  vfsRegistry: { id: 'id', objectType: 'object_type', createdAt: 'created_at' }
}));

import { useDatabaseContext } from '@/db/hooks';
import { useVfsUnfiledItems } from './useVfsUnfiledItems';

describe('useVfsUnfiledItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockResolvedValue([]);
  });

  it('returns empty items when not unlocked', () => {
    vi.mocked(useDatabaseContext).mockReturnValue({
      isUnlocked: false,
      currentInstanceId: null
    } as ReturnType<typeof useDatabaseContext>);

    const { result } = renderHook(() => useVfsUnfiledItems());

    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns refetch function', () => {
    vi.mocked(useDatabaseContext).mockReturnValue({
      isUnlocked: false,
      currentInstanceId: null
    } as ReturnType<typeof useDatabaseContext>);

    const { result } = renderHook(() => useVfsUnfiledItems());

    expect(typeof result.current.refetch).toBe('function');
  });

  it('has correct initial state', () => {
    vi.mocked(useDatabaseContext).mockReturnValue({
      isUnlocked: false,
      currentInstanceId: null
    } as ReturnType<typeof useDatabaseContext>);

    const { result } = renderHook(() => useVfsUnfiledItems());

    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.hasFetched).toBe(false);
  });

  it('fetches items when unlocked', async () => {
    vi.mocked(useDatabaseContext).mockReturnValue({
      isUnlocked: true,
      currentInstanceId: 'test-instance'
    } as ReturnType<typeof useDatabaseContext>);

    // Mock vfs_links query - no linked items
    mockFrom.mockResolvedValueOnce([]);

    // Mock vfs_registry query - one folder
    mockFrom.mockResolvedValueOnce([
      { id: 'folder-1', objectType: 'folder', createdAt: new Date() }
    ]);

    // Mock folders name lookup
    mockWhere.mockResolvedValueOnce([{ id: 'folder-1', name: 'My Folder' }]);

    const { result } = renderHook(() => useVfsUnfiledItems());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });
  });

  it('handles empty registry', async () => {
    vi.mocked(useDatabaseContext).mockReturnValue({
      isUnlocked: true,
      currentInstanceId: 'test-instance'
    } as ReturnType<typeof useDatabaseContext>);

    // Mock vfs_links query - no linked items
    mockFrom.mockResolvedValueOnce([]);

    // Mock vfs_registry query - no items
    mockFrom.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useVfsUnfiledItems());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.items).toEqual([]);
  });

  it('handles database errors', async () => {
    vi.mocked(useDatabaseContext).mockReturnValue({
      isUnlocked: true,
      currentInstanceId: 'test-instance'
    } as ReturnType<typeof useDatabaseContext>);

    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    // Mock vfs_links query to throw error
    mockFrom.mockRejectedValueOnce(new Error('Database error'));

    const { result } = renderHook(() => useVfsUnfiledItems());

    await waitFor(() => {
      expect(result.current.error).toBe('Database error');
    });

    expect(result.current.loading).toBe(false);
    consoleError.mockRestore();
  });

  it('refetch function works', async () => {
    vi.mocked(useDatabaseContext).mockReturnValue({
      isUnlocked: true,
      currentInstanceId: 'test-instance'
    } as ReturnType<typeof useDatabaseContext>);

    // Initial fetch
    mockFrom.mockResolvedValueOnce([]);
    mockFrom.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useVfsUnfiledItems());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    // Setup for refetch
    mockFrom.mockResolvedValueOnce([]);
    mockFrom.mockResolvedValueOnce([]);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.loading).toBe(false);
  });

  it('skips refetch if not unlocked', async () => {
    vi.mocked(useDatabaseContext).mockReturnValue({
      isUnlocked: false,
      currentInstanceId: null
    } as ReturnType<typeof useDatabaseContext>);

    const { result } = renderHook(() => useVfsUnfiledItems());

    await act(async () => {
      await result.current.refetch();
    });

    // Should not have called database
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('handles linked items filtering', async () => {
    vi.mocked(useDatabaseContext).mockReturnValue({
      isUnlocked: true,
      currentInstanceId: 'test-instance'
    } as ReturnType<typeof useDatabaseContext>);

    // Mock vfs_links query - some linked items
    mockFrom.mockResolvedValueOnce([
      { childId: 'linked-folder-1' },
      { childId: 'linked-folder-2' }
    ]);

    // Mock vfs_registry query with where clause (filtering out linked)
    mockWhere.mockResolvedValueOnce([
      { id: 'unlinked-folder', objectType: 'folder', createdAt: new Date() }
    ]);

    // Mock folder name lookup
    mockWhere.mockResolvedValueOnce([
      { id: 'unlinked-folder', name: 'Unlinked Folder' }
    ]);

    const { result } = renderHook(() => useVfsUnfiledItems());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });
  });

  it('clears items on instance change', async () => {
    const mockContext = vi.mocked(useDatabaseContext);

    mockContext.mockReturnValue({
      isUnlocked: true,
      currentInstanceId: 'instance-1'
    } as ReturnType<typeof useDatabaseContext>);

    // Initial fetch
    mockFrom.mockResolvedValueOnce([]);
    mockFrom.mockResolvedValueOnce([
      { id: 'folder-1', objectType: 'folder', createdAt: new Date() }
    ]);
    mockWhere.mockResolvedValueOnce([{ id: 'folder-1', name: 'Folder 1' }]);

    const { result, rerender } = renderHook(() => useVfsUnfiledItems());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    // Change instance
    mockContext.mockReturnValue({
      isUnlocked: true,
      currentInstanceId: 'instance-2'
    } as ReturnType<typeof useDatabaseContext>);

    // Setup for new instance fetch
    mockFrom.mockResolvedValueOnce([]);
    mockFrom.mockResolvedValueOnce([]);

    rerender();

    await waitFor(() => {
      expect(result.current.items).toEqual([]);
    });
  });

  it('handles non-Error exceptions', async () => {
    vi.mocked(useDatabaseContext).mockReturnValue({
      isUnlocked: true,
      currentInstanceId: 'test-instance'
    } as ReturnType<typeof useDatabaseContext>);

    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    // Mock vfs_links query to throw non-Error
    mockFrom.mockRejectedValueOnce('String error');

    const { result } = renderHook(() => useVfsUnfiledItems());

    await waitFor(() => {
      expect(result.current.error).toBe('String error');
    });

    consoleError.mockRestore();
  });
});
