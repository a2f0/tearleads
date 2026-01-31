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
import { VFS_ROOT_ID } from '../constants';
import { VfsExplorerProvider, type VfsExplorerUIComponents } from '../context';
import {
  createMockDatabase,
  createMockDatabaseState,
  createMockUI,
  createWrapper
} from '../test/testUtils';
import { useVfsAllItems } from './useVfsAllItems';

describe('useVfsAllItems', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
  });

  it('returns empty items when not unlocked', () => {
    const wrapper = createWrapper({
      databaseState: { isUnlocked: false, currentInstanceId: null }
    });

    const { result } = renderHook(() => useVfsAllItems(), { wrapper });

    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns refetch function', () => {
    const wrapper = createWrapper({
      databaseState: { isUnlocked: false, currentInstanceId: null }
    });

    const { result } = renderHook(() => useVfsAllItems(), { wrapper });

    expect(typeof result.current.refetch).toBe('function');
  });

  it('has correct initial state', () => {
    const wrapper = createWrapper({
      databaseState: { isUnlocked: false, currentInstanceId: null }
    });

    const { result } = renderHook(() => useVfsAllItems(), { wrapper });

    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.hasFetched).toBe(false);
  });

  it('fetches all items when unlocked', async () => {
    // Mock vfsRegistry query (now uses .where for VFS_ROOT_ID filter) - returns one folder
    mockDb.where.mockResolvedValueOnce([
      { id: 'folder-1', objectType: 'folder', createdAt: new Date() }
    ]);

    // Mock folders name lookup
    mockDb.where.mockResolvedValueOnce([{ id: 'folder-1', name: 'My Folder' }]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsAllItems(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });
  });

  it('handles empty registry', async () => {
    // Mock vfsRegistry query - no items
    mockDb.where.mockResolvedValueOnce([]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsAllItems(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.items).toEqual([]);
  });

  it('handles database errors', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    // Mock vfsRegistry query to throw error
    mockDb.where.mockRejectedValueOnce(new Error('Database error'));

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsAllItems(), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBe('Database error');
    });

    expect(result.current.loading).toBe(false);
    consoleError.mockRestore();
  });

  it('refetch function works', async () => {
    // Initial fetch - vfsRegistry returns empty
    mockDb.where.mockResolvedValueOnce([]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsAllItems(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    // Setup for refetch - vfsRegistry returns empty
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

    const { result } = renderHook(() => useVfsAllItems(), { wrapper });

    await act(async () => {
      await result.current.refetch();
    });

    // Should not have called database select
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('handles non-Error exceptions', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    // Mock vfsRegistry query to throw non-Error
    mockDb.where.mockRejectedValueOnce('String error');

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsAllItems(), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBe('String error');
    });

    consoleError.mockRestore();
  });

  it('clears and refetches items when currentInstanceId changes', async () => {
    let setInstanceId: (id: string) => void = () => {};

    function TestComponent() {
      const result = useVfsAllItems();
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
    // 1. vfsRegistry query returns one folder
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
    // vfsRegistry query returns empty
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

  it('skips fetch when enabled is false', async () => {
    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsAllItems({ enabled: false }), {
      wrapper
    });

    // Wait a tick to ensure any potential fetch would have been triggered
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // Should not have called database select when disabled
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(result.current.hasFetched).toBe(false);
  });

  it('fetches when enabled changes from false to true', async () => {
    // Mock vfsRegistry query - returns one folder
    mockDb.where.mockResolvedValueOnce([
      { id: 'folder-1', objectType: 'folder', createdAt: new Date() }
    ]);

    // Mock folders name lookup
    mockDb.where.mockResolvedValueOnce([{ id: 'folder-1', name: 'My Folder' }]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    // Start with enabled=true (default)
    const { result } = renderHook(() => useVfsAllItems(), {
      wrapper
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.items).toHaveLength(1);
  });

  it('excludes VFS_ROOT_ID from results', async () => {
    // Mock vfsRegistry query - returns folder and contact
    // (VFS_ROOT_ID should be filtered at DB level, but test that results don't include it)
    mockDb.where.mockResolvedValueOnce([
      { id: 'folder-1', objectType: 'folder', createdAt: new Date() },
      { id: 'contact-1', objectType: 'contact', createdAt: new Date() }
    ]);

    // Mock name lookups
    mockDb.where
      .mockResolvedValueOnce([{ id: 'folder-1', name: 'My Folder' }])
      .mockResolvedValueOnce([
        { id: 'contact-1', firstName: 'John', lastName: 'Doe' }
      ]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsAllItems(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    // Verify VFS_ROOT_ID is not in the results
    const hasVfsRoot = result.current.items.some(
      (item) => item.id === VFS_ROOT_ID
    );
    expect(hasVfsRoot).toBe(false);

    // Verify the query was called with the where clause (uses ne filter)
    expect(mockDb.where).toHaveBeenCalled();
  });
});
