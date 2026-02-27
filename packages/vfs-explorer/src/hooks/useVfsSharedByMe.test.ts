import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOT_LOGGED_IN_ERROR } from '../constants';
import {
  createMockDatabase,
  createMockDatabaseState,
  createWrapper
} from '../test/testUtils';
import { useVfsSharedByMe } from './useVfsSharedByMe';

describe('useVfsSharedByMe', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
  });

  it('returns empty items when not unlocked', () => {
    const wrapper = createWrapper({
      databaseState: { isUnlocked: false, currentInstanceId: null }
    });

    const { result } = renderHook(() => useVfsSharedByMe(), {
      wrapper
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('returns empty items when not enabled', () => {
    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsSharedByMe({ enabled: false }), {
      wrapper
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('returns error when not logged in', async () => {
    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb,
      auth: {
        readStoredAuth: vi.fn(() => ({ user: null }))
      }
    });

    const { result } = renderHook(() => useVfsSharedByMe(), {
      wrapper
    });

    await waitFor(() => {
      expect(result.current.error).toBe(NOT_LOGGED_IN_ERROR);
    });
  });

  it('fetches shared items when unlocked and logged in', async () => {
    mockDb.orderBy.mockResolvedValueOnce([
      {
        id: 'item-1',
        objectType: 'folder',
        name: 'Shared Folder',
        createdAt: new Date(),
        shareId: 'share-1',
        targetId: 'user-2',
        targetName: 'user-2',
        shareType: 'user',
        permissionLevel: 'view',
        sharedAt: new Date(),
        expiresAt: null
      },
      {
        id: 'item-2',
        objectType: 'note',
        name: 'Shared Note',
        createdAt: new Date(),
        shareId: 'share-2',
        targetId: 'user-3',
        targetName: 'user-3',
        shareType: 'user',
        permissionLevel: 'edit',
        sharedAt: new Date(),
        expiresAt: new Date('2025-12-31')
      }
    ]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsSharedByMe(), {
      wrapper
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0]?.name).toBe('Shared Folder');
    expect(result.current.items[0]?.shareType).toBe('user');
    expect(result.current.items[1]?.name).toBe('Shared Note');
    expect(result.current.items[1]?.permissionLevel).toBe('edit');
  });

  it('returns empty items when user has not shared anything', async () => {
    mockDb.orderBy.mockResolvedValueOnce([]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsSharedByMe(), {
      wrapper
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.items).toEqual([]);
  });

  it('handles fetch errors', async () => {
    mockDb.orderBy.mockRejectedValueOnce(new Error('Database error'));

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsSharedByMe(), {
      wrapper
    });

    await waitFor(() => {
      expect(result.current.error).toBe('Database error');
    });

    expect(result.current.items).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to fetch VFS shared by me items:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });

  it('returns refetch function', () => {
    const wrapper = createWrapper({
      databaseState: { isUnlocked: false, currentInstanceId: null }
    });

    const { result } = renderHook(() => useVfsSharedByMe(), {
      wrapper
    });

    expect(typeof result.current.refetch).toBe('function');
  });

  it('refetch function works', async () => {
    mockDb.orderBy.mockResolvedValueOnce([]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsSharedByMe(), {
      wrapper
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    mockDb.orderBy.mockResolvedValueOnce([]);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.loading).toBe(false);
  });

  it('handles non-Error exceptions', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    mockDb.orderBy.mockRejectedValueOnce('String error');

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsSharedByMe(), {
      wrapper
    });

    await waitFor(() => {
      expect(result.current.error).toBe('String error');
    });

    consoleError.mockRestore();
  });

  it('converts database dates to Date objects', async () => {
    const createdAt = new Date('2024-01-15T10:00:00.000Z');
    const sharedAt = new Date('2024-01-20T10:00:00.000Z');
    const expiresAt = new Date('2025-12-31T23:59:59.000Z');

    mockDb.orderBy.mockResolvedValueOnce([
      {
        id: 'item-1',
        objectType: 'folder',
        name: 'Shared Folder',
        createdAt,
        shareId: 'share-1',
        targetId: 'user-2',
        targetName: 'user-2',
        shareType: 'user',
        permissionLevel: 'view',
        sharedAt,
        expiresAt
      }
    ]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsSharedByMe(), {
      wrapper
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.items[0]?.createdAt).toBeInstanceOf(Date);
    expect(result.current.items[0]?.sharedAt).toBeInstanceOf(Date);
    expect(result.current.items[0]?.expiresAt).toBeInstanceOf(Date);
  });

  it('handles null expiresAt', async () => {
    mockDb.orderBy.mockResolvedValueOnce([
      {
        id: 'item-1',
        objectType: 'folder',
        name: 'Shared Folder',
        createdAt: new Date(),
        shareId: 'share-1',
        targetId: 'user-2',
        targetName: 'user-2',
        shareType: 'user',
        permissionLevel: 'view',
        sharedAt: new Date(),
        expiresAt: null
      }
    ]);

    const wrapper = createWrapper({
      databaseState: createMockDatabaseState(),
      database: mockDb
    });

    const { result } = renderHook(() => useVfsSharedByMe(), {
      wrapper
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.items[0]?.expiresAt).toBeNull();
  });
});
