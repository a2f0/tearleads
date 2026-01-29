import type { Database } from '@rapid/db/sqlite';
import {
  act,
  render,
  renderHook,
  screen,
  waitFor
} from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VfsExplorerProvider, type VfsExplorerUIComponents } from '../context';
import {
  createMockDatabase,
  createMockDatabaseState,
  createMockUI,
  createWrapper
} from '../test/testUtils';
import { useVfsUnfiledItems } from './useVfsUnfiledItems';

describe('useVfsUnfiledItems', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
  });

  it('returns empty items when not unlocked', () => {
    const wrapper = createWrapper({
      databaseState: { isUnlocked: false, currentInstanceId: null }
    });

    const { result } = renderHook(() => useVfsUnfiledItems(), { wrapper });

    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns refetch function', () => {
    const wrapper = createWrapper({
      databaseState: { isUnlocked: false, currentInstanceId: null }
    });

    const { result } = renderHook(() => useVfsUnfiledItems(), { wrapper });

    expect(typeof result.current.refetch).toBe('function');
  });

  it('has correct initial state', () => {
    const wrapper = createWrapper({
      databaseState: { isUnlocked: false, currentInstanceId: null }
    });

    const { result } = renderHook(() => useVfsUnfiledItems(), { wrapper });

    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.hasFetched).toBe(false);
  });

  it('fetches items when unlocked', async () => {
    // Mock vfs_links query - no linked items
    mockDb.from.mockResolvedValueOnce([]);

    // Mock vfs_registry query - one folder
    mockDb.from.mockResolvedValueOnce([
      { id: 'folder-1', objectType: 'folder', createdAt: new Date() }
    ]);

    // Mock folders name lookup
    mockDb.where.mockResolvedValueOnce([{ id: 'folder-1', name: 'My Folder' }]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsUnfiledItems(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });
  });

  it('handles empty registry', async () => {
    // Mock vfs_links query - no linked items
    mockDb.from.mockResolvedValueOnce([]);

    // Mock vfs_registry query - no items
    mockDb.from.mockResolvedValueOnce([]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsUnfiledItems(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.items).toEqual([]);
  });

  it('handles database errors', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    // Mock vfs_links query to throw error
    mockDb.from.mockRejectedValueOnce(new Error('Database error'));

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsUnfiledItems(), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBe('Database error');
    });

    expect(result.current.loading).toBe(false);
    consoleError.mockRestore();
  });

  it('refetch function works', async () => {
    // Initial fetch
    mockDb.from.mockResolvedValueOnce([]);
    mockDb.from.mockResolvedValueOnce([]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsUnfiledItems(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    // Setup for refetch
    mockDb.from.mockResolvedValueOnce([]);
    mockDb.from.mockResolvedValueOnce([]);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.loading).toBe(false);
  });

  it('skips refetch if not unlocked', async () => {
    const wrapper = createWrapper({
      databaseState: { isUnlocked: false, currentInstanceId: null },
      database: mockDb
    });

    const { result } = renderHook(() => useVfsUnfiledItems(), { wrapper });

    await act(async () => {
      await result.current.refetch();
    });

    // Should not have called database select
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('handles linked items filtering', async () => {
    // Mock vfs_links query - some linked items
    mockDb.from.mockResolvedValueOnce([
      { childId: 'linked-folder-1' },
      { childId: 'linked-folder-2' }
    ]);

    // Mock vfs_registry query with where clause (filtering out linked)
    mockDb.where.mockResolvedValueOnce([
      { id: 'unlinked-folder', objectType: 'folder', createdAt: new Date() }
    ]);

    // Mock folder name lookup
    mockDb.where.mockResolvedValueOnce([
      { id: 'unlinked-folder', name: 'Unlinked Folder' }
    ]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsUnfiledItems(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });
  });

  it('handles non-Error exceptions', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    // Mock vfs_links query to throw non-Error
    mockDb.from.mockRejectedValueOnce('String error');

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsUnfiledItems(), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBe('String error');
    });

    consoleError.mockRestore();
  });

  it('clears and refetches items when currentInstanceId changes', async () => {
    // This tests the automatic refetch behavior when instance changes.
    // We use a test component with state in the wrapper to change the instanceId.
    let setInstanceId: (id: string) => void = () => {};

    function TestComponent() {
      const result = useVfsUnfiledItems();
      return (
        <div>
          <span data-testid="items-count">{result.items.length}</span>
          <span data-testid="first-item-name">
            {result.items[0]?.name ?? 'none'}
          </span>
          <span data-testid="has-fetched">{String(result.hasFetched)}</span>
        </div>
      );
    }

    function TestWrapper() {
      const [instanceId, _setInstanceId] = useState('instance-1');
      setInstanceId = _setInstanceId;

      const ui = createMockUI();

      return (
        <VfsExplorerProvider
          databaseState={{
            isUnlocked: true,
            isLoading: false,
            currentInstanceId: instanceId
          }}
          getDatabase={() => mockDb as unknown as Database}
          ui={ui as unknown as VfsExplorerUIComponents}
          vfsKeys={{
            generateSessionKey: vi.fn(() => new Uint8Array(32)),
            wrapSessionKey: vi.fn(async () => 'wrapped-key')
          }}
          auth={{
            isLoggedIn: vi.fn(() => false),
            readStoredAuth: vi.fn(() => ({ user: { id: 'test' } }))
          }}
          featureFlags={{
            getFeatureFlagValue: vi.fn(() => false)
          }}
          vfsApi={{
            register: vi.fn(async () => {})
          }}
        >
          <TestComponent />
        </VfsExplorerProvider>
      );
    }

    // Mock initial fetch for instance-1
    // 1. vfs_links query (no linked items)
    mockDb.from.mockResolvedValueOnce([]);
    // 2. vfs_registry query (one folder)
    mockDb.from.mockResolvedValueOnce([
      { id: 'folder-1', objectType: 'folder', createdAt: new Date() }
    ]);
    // 3. folder name lookup
    mockDb.where.mockResolvedValueOnce([{ id: 'folder-1', name: 'My Folder' }]);

    render(<TestWrapper />);

    await waitFor(() => {
      expect(screen.getByTestId('has-fetched')).toHaveTextContent('true');
    });

    expect(screen.getByTestId('items-count')).toHaveTextContent('1');
    expect(screen.getByTestId('first-item-name')).toHaveTextContent(
      'My Folder'
    );

    // Mock fetch for instance-2 (no items)
    // 1. vfs_links query
    mockDb.from.mockResolvedValueOnce([]);
    // 2. vfs_registry query (no items)
    mockDb.from.mockResolvedValueOnce([]);

    // Trigger instance change
    act(() => {
      setInstanceId('instance-2');
    });

    await waitFor(() => {
      expect(screen.getByTestId('items-count')).toHaveTextContent('0');
    });

    expect(screen.getByTestId('first-item-name')).toHaveTextContent('none');
  });
});
