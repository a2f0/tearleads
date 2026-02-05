import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockDatabase,
  createMockDatabaseState,
  createWrapper
} from '../test/testUtils';
import { useVfsFolderContents } from './useVfsFolderContents';

describe('useVfsFolderContents', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
  });

  it('returns empty items when not unlocked', () => {
    const wrapper = createWrapper({
      databaseState: { isUnlocked: false, currentInstanceId: null }
    });

    const { result } = renderHook(() => useVfsFolderContents('folder-1'), {
      wrapper
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('returns empty items when folderId is null', async () => {
    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsFolderContents(null), {
      wrapper
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.items).toEqual([]);
  });

  it('fetches folder contents when unlocked', async () => {
    // Mock unified query (JOINs + WHERE + ORDER BY) - returns items with names resolved
    mockDb.orderBy.mockResolvedValueOnce([
      {
        id: 'child-1',
        linkId: 'link-1',
        objectType: 'folder',
        name: 'Subfolder',
        createdAt: new Date()
      },
      {
        id: 'child-2',
        linkId: 'link-2',
        objectType: 'note',
        name: 'My Note',
        createdAt: new Date()
      }
    ]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsFolderContents('parent-folder'), {
      wrapper
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0]?.name).toBe('Subfolder');
    expect(result.current.items[0]?.objectType).toBe('folder');
    expect(result.current.items[1]?.name).toBe('My Note');
    expect(result.current.items[1]?.objectType).toBe('note');
  });

  it('returns empty items when folder has no children', async () => {
    // Mock unified query - no children
    mockDb.orderBy.mockResolvedValueOnce([]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsFolderContents('empty-folder'), {
      wrapper
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.items).toEqual([]);
  });

  it('handles fetch errors', async () => {
    // Mock unified query to throw error
    mockDb.orderBy.mockRejectedValueOnce(new Error('Database error'));

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsFolderContents('folder-1'), {
      wrapper
    });

    await waitFor(() => {
      expect(result.current.error).toBe('Database error');
    });

    expect(result.current.items).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to fetch VFS folder contents:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });

  it('returns items in database-provided order (SQL ORDER BY)', async () => {
    // Mock unified query - DB returns sorted order (folders first, then alpha)
    mockDb.orderBy.mockResolvedValueOnce([
      {
        id: 'folder-1',
        linkId: 'link-2',
        objectType: 'folder',
        name: 'Zebra Folder',
        createdAt: new Date()
      },
      {
        id: 'note-1',
        linkId: 'link-1',
        objectType: 'note',
        name: 'Apple Note',
        createdAt: new Date()
      },
      {
        id: 'note-2',
        linkId: 'link-3',
        objectType: 'note',
        name: 'Banana Note',
        createdAt: new Date()
      }
    ]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsFolderContents('parent'), {
      wrapper
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    // Items come back in the order the DB returned them
    expect(result.current.items[0]?.objectType).toBe('folder');
    expect(result.current.items[1]?.name).toBe('Apple Note');
    expect(result.current.items[2]?.name).toBe('Banana Note');
  });

  it('fetches file and photo names correctly', async () => {
    // Mock unified query - names resolved via COALESCE in SQL
    mockDb.orderBy.mockResolvedValueOnce([
      {
        id: 'file-1',
        linkId: 'link-1',
        objectType: 'file',
        name: 'document.pdf',
        createdAt: new Date()
      },
      {
        id: 'photo-1',
        linkId: 'link-2',
        objectType: 'photo',
        name: 'vacation.jpg',
        createdAt: new Date()
      }
    ]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsFolderContents('parent-folder'), {
      wrapper
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items.find((i) => i.id === 'file-1')?.name).toBe(
      'document.pdf'
    );
    expect(result.current.items.find((i) => i.id === 'photo-1')?.name).toBe(
      'vacation.jpg'
    );
  });

  it('fetches contact names correctly', async () => {
    // Mock unified query - contact name resolved via COALESCE in SQL
    mockDb.orderBy.mockResolvedValueOnce([
      {
        id: 'contact-1',
        linkId: 'link-1',
        objectType: 'contact',
        name: 'John Doe',
        createdAt: new Date()
      }
    ]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsFolderContents('parent-folder'), {
      wrapper
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.name).toBe('John Doe');
  });

  it('returns refetch function', () => {
    const wrapper = createWrapper({
      databaseState: { isUnlocked: false, currentInstanceId: null }
    });

    const { result } = renderHook(() => useVfsFolderContents('folder-1'), {
      wrapper
    });

    expect(typeof result.current.refetch).toBe('function');
  });

  it('refetch function works', async () => {
    // Initial fetch
    mockDb.orderBy.mockResolvedValueOnce([]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsFolderContents('folder-1'), {
      wrapper
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    // Setup for refetch
    mockDb.orderBy.mockResolvedValueOnce([]);

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

    const { result } = renderHook(() => useVfsFolderContents('folder-1'), {
      wrapper
    });

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

    // Mock unified query to throw non-Error
    mockDb.orderBy.mockRejectedValueOnce('String error');

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsFolderContents('folder-1'), {
      wrapper
    });

    await waitFor(() => {
      expect(result.current.error).toBe('String error');
    });

    consoleError.mockRestore();
  });
});
