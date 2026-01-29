import { renderHook, waitFor } from '@testing-library/react';
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
    const mockLinkRows = [
      { linkId: 'link-1', childId: 'child-1' },
      { linkId: 'link-2', childId: 'child-2' }
    ];

    const mockRegistryRows = [
      { id: 'child-1', objectType: 'folder', createdAt: Date.now() },
      { id: 'child-2', objectType: 'note', createdAt: Date.now() }
    ];

    const mockFolderNameRows = [{ id: 'child-1', name: 'Subfolder' }];
    const mockNoteRows = [{ id: 'child-2', title: 'My Note' }];

    mockDb.where
      .mockResolvedValueOnce(mockLinkRows)
      .mockResolvedValueOnce(mockRegistryRows)
      .mockResolvedValueOnce(mockFolderNameRows)
      .mockResolvedValueOnce(mockNoteRows);

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
    mockDb.where.mockResolvedValueOnce([]);

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
    mockDb.where.mockRejectedValueOnce(new Error('Database error'));

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

  it('sorts folders first then alphabetically', async () => {
    const mockLinkRows = [
      { linkId: 'link-1', childId: 'note-1' },
      { linkId: 'link-2', childId: 'folder-1' },
      { linkId: 'link-3', childId: 'note-2' }
    ];

    const mockRegistryRows = [
      { id: 'note-1', objectType: 'note', createdAt: Date.now() },
      { id: 'folder-1', objectType: 'folder', createdAt: Date.now() },
      { id: 'note-2', objectType: 'note', createdAt: Date.now() }
    ];

    const mockFolderNameRows = [{ id: 'folder-1', name: 'Zebra Folder' }];
    const mockNoteRows = [
      { id: 'note-1', title: 'Apple Note' },
      { id: 'note-2', title: 'Banana Note' }
    ];

    mockDb.where
      .mockResolvedValueOnce(mockLinkRows)
      .mockResolvedValueOnce(mockRegistryRows)
      .mockResolvedValueOnce(mockFolderNameRows)
      .mockResolvedValueOnce(mockNoteRows);

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

    expect(result.current.items[0]?.objectType).toBe('folder');
    expect(result.current.items[1]?.name).toBe('Apple Note');
    expect(result.current.items[2]?.name).toBe('Banana Note');
  });

  it('fetches file and photo names correctly', async () => {
    const mockLinkRows = [
      { linkId: 'link-1', childId: 'file-1' },
      { linkId: 'link-2', childId: 'photo-1' }
    ];

    const mockRegistryRows = [
      { id: 'file-1', objectType: 'file', createdAt: Date.now() },
      { id: 'photo-1', objectType: 'photo', createdAt: Date.now() }
    ];

    const mockFileRows = [
      { id: 'file-1', name: 'document.pdf' },
      { id: 'photo-1', name: 'vacation.jpg' }
    ];

    mockDb.where
      .mockResolvedValueOnce(mockLinkRows)
      .mockResolvedValueOnce(mockRegistryRows)
      .mockResolvedValueOnce(mockFileRows);

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
    const mockLinkRows = [{ linkId: 'link-1', childId: 'contact-1' }];

    const mockRegistryRows = [
      { id: 'contact-1', objectType: 'contact', createdAt: Date.now() }
    ];

    const mockContactRows = [
      { id: 'contact-1', firstName: 'John', lastName: 'Doe' }
    ];

    mockDb.where
      .mockResolvedValueOnce(mockLinkRows)
      .mockResolvedValueOnce(mockRegistryRows)
      .mockResolvedValueOnce(mockContactRows);

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
});
