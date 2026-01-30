import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePhotoAlbums } from './usePhotoAlbums';

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockFrom = vi.fn();
const mockInnerJoin = vi.fn();
const mockWhere = vi.fn();
const mockSet = vi.fn();
const mockValues = vi.fn();

const mockDb = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete
};

vi.mock('@/db', () => ({
  getDatabase: () => mockDb
}));

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({
    isUnlocked: true,
    currentInstanceId: 'test-instance'
  })
}));

describe('usePhotoAlbums', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock chain for select queries
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ innerJoin: mockInnerJoin, where: mockWhere });
    mockInnerJoin.mockReturnValue({ where: mockWhere });
    mockWhere.mockResolvedValue([]);

    // Setup mock chain for insert
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockResolvedValue(undefined);

    // Setup mock chain for update
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockWhere });

    // Setup mock chain for delete
    mockDelete.mockReturnValue({ where: mockWhere });
  });

  it('returns initial state', () => {
    const { result } = renderHook(() => usePhotoAlbums());

    expect(result.current.albums).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.hasFetched).toBe(false);
  });

  it('exposes album operations', () => {
    const { result } = renderHook(() => usePhotoAlbums());

    expect(typeof result.current.createAlbum).toBe('function');
    expect(typeof result.current.renameAlbum).toBe('function');
    expect(typeof result.current.deleteAlbum).toBe('function');
    expect(typeof result.current.addPhotoToAlbum).toBe('function');
    expect(typeof result.current.removePhotoFromAlbum).toBe('function');
    expect(typeof result.current.getPhotoIdsInAlbum).toBe('function');
    expect(typeof result.current.refetch).toBe('function');
  });

  it('fetches albums on mount when unlocked', async () => {
    renderHook(() => usePhotoAlbums());

    await waitFor(() => {
      expect(mockSelect).toHaveBeenCalled();
    });
  });

  it('creates album with registry and metadata', async () => {
    const { result } = renderHook(() => usePhotoAlbums());

    await act(async () => {
      await result.current.createAlbum('Test Album');
    });

    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it('renames album', async () => {
    const { result } = renderHook(() => usePhotoAlbums());

    await act(async () => {
      await result.current.renameAlbum('album-123', 'New Name');
    });

    expect(mockUpdate).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith({ encryptedName: 'New Name' });
  });

  it('deletes album with links and metadata', async () => {
    const { result } = renderHook(() => usePhotoAlbums());

    await act(async () => {
      await result.current.deleteAlbum('album-123');
    });

    expect(mockDelete).toHaveBeenCalledTimes(3);
  });

  it('gets photo IDs in album', async () => {
    mockWhere.mockResolvedValueOnce([
      { childId: 'photo-1' },
      { childId: 'photo-2' }
    ]);

    const { result } = renderHook(() => usePhotoAlbums());

    let photoIds: string[] = [];
    await act(async () => {
      photoIds = await result.current.getPhotoIdsInAlbum('album-123');
    });

    expect(photoIds).toEqual(['photo-1', 'photo-2']);
  });

  it('adds photo to album', async () => {
    mockWhere.mockResolvedValueOnce([]);

    const { result } = renderHook(() => usePhotoAlbums());

    await act(async () => {
      await result.current.addPhotoToAlbum('album-123', 'photo-456');
    });

    expect(mockInsert).toHaveBeenCalled();
  });

  it('skips adding photo if already in album', async () => {
    mockWhere.mockResolvedValueOnce([{ id: 'existing-link' }]);

    const { result } = renderHook(() => usePhotoAlbums());

    await act(async () => {
      await result.current.addPhotoToAlbum('album-123', 'photo-456');
    });

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('removes photo from album', async () => {
    const { result } = renderHook(() => usePhotoAlbums());

    await act(async () => {
      await result.current.removePhotoFromAlbum('album-123', 'photo-456');
    });

    expect(mockDelete).toHaveBeenCalled();
  });

  it('fetches and processes albums with photo counts', async () => {
    // First call returns albums
    mockWhere.mockResolvedValueOnce([
      { id: 'album-1', name: 'Zebra Album', coverPhotoId: null },
      { id: 'album-2', name: 'Alpha Album', coverPhotoId: 'photo-1' }
    ]);
    // Second call returns photo links (for counting)
    mockWhere.mockResolvedValueOnce([
      { parentId: 'album-1' },
      { parentId: 'album-1' },
      { parentId: 'album-2' }
    ]);

    const { result } = renderHook(() => usePhotoAlbums());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    // Albums should be sorted alphabetically
    expect(result.current.albums.length).toBe(2);
    expect(result.current.albums[0].name).toBe('Alpha Album');
    expect(result.current.albums[1].name).toBe('Zebra Album');

    // Photo counts should be calculated
    expect(result.current.albums[0].photoCount).toBe(1); // Alpha has 1 photo
    expect(result.current.albums[1].photoCount).toBe(2); // Zebra has 2 photos
  });

  it('handles albums with no name', async () => {
    mockWhere.mockResolvedValueOnce([
      { id: 'album-1', name: null, coverPhotoId: null }
    ]);
    mockWhere.mockResolvedValueOnce([]);

    const { result } = renderHook(() => usePhotoAlbums());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.albums[0].name).toBe('Unnamed Album');
  });

  it('handles fetch error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockWhere.mockRejectedValueOnce(new Error('Database error'));

    const { result } = renderHook(() => usePhotoAlbums());

    await waitFor(() => {
      expect(result.current.error).toBe('Database error');
    });

    consoleSpy.mockRestore();
  });

  it('handles non-Error objects in catch', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockWhere.mockRejectedValueOnce('String error');

    const { result } = renderHook(() => usePhotoAlbums());

    await waitFor(() => {
      expect(result.current.error).toBe('String error');
    });

    consoleSpy.mockRestore();
  });
});
