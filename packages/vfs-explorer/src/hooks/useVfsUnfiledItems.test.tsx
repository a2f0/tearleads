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
    // Mock LEFT JOIN query for unfiled items - returns one folder
    mockDb.where.mockResolvedValueOnce([
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
    // Mock LEFT JOIN query - no unfiled items
    mockDb.where.mockResolvedValueOnce([]);

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

    // Mock LEFT JOIN query to throw error
    mockDb.where.mockRejectedValueOnce(new Error('Database error'));

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
    // Initial fetch - LEFT JOIN returns empty
    mockDb.where.mockResolvedValueOnce([]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsUnfiledItems(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    // Setup for refetch - LEFT JOIN returns empty
    mockDb.where.mockResolvedValueOnce([]);

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
    // Mock LEFT JOIN query - only unfiled items returned (linked items excluded by DB)
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

    // Mock LEFT JOIN query to throw non-Error
    mockDb.where.mockRejectedValueOnce('String error');

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

    // Mock initial fetch for instance-1 using LEFT JOIN
    // 1. LEFT JOIN query returns one folder
    mockDb.where.mockResolvedValueOnce([
      { id: 'folder-1', objectType: 'folder', createdAt: new Date() }
    ]);
    // 2. folder name lookup
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
    // LEFT JOIN query returns empty
    mockDb.where.mockResolvedValueOnce([]);

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
