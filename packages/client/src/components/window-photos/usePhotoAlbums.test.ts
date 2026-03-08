import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSystemAlbumInitGuard, usePhotoAlbums } from './usePhotoAlbums';

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockFrom = vi.fn();
const mockInnerJoin = vi.fn();
const mockWhere = vi.fn();
const mockSet = vi.fn();
const mockValues = vi.fn();
const mockTransaction = vi.fn(async (cb: (tx: typeof mockDb) => unknown) =>
  cb(mockDb)
);

const mockDb = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
  transaction: mockTransaction
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
    resetSystemAlbumInitGuard();

    // Setup mock chain for select queries
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ innerJoin: mockInnerJoin, where: mockWhere });
    mockInnerJoin.mockReturnValue({ where: mockWhere });
    // First call is for system album initialization check - return existing album
    // Subsequent calls return empty by default
    mockWhere
      .mockResolvedValueOnce([{ id: 'photoroll-id' }]) // System album check
      .mockResolvedValue([]); // Default for subsequent calls

    // Setup mock chain for insert
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockResolvedValue(undefined);

    // Setup mock chain for update
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockWhere });

    // Setup mock chain for delete
    mockDelete.mockReturnValue({ where: mockWhere });
  });

  it('returns initial state', async () => {
    const { result } = renderHook(() => usePhotoAlbums());

    // Initial synchronous state
    expect(result.current.albums).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.hasFetched).toBe(false);

    // Wait for async initialization to complete
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('exposes album operations', async () => {
    const { result } = renderHook(() => usePhotoAlbums());

    expect(typeof result.current.createAlbum).toBe('function');
    expect(typeof result.current.renameAlbum).toBe('function');
    expect(typeof result.current.deleteAlbum).toBe('function');
    expect(typeof result.current.addPhotoToAlbum).toBe('function');
    expect(typeof result.current.removePhotoFromAlbum).toBe('function');
    expect(typeof result.current.getPhotoIdsInAlbum).toBe('function');
    expect(typeof result.current.getPhotoRollAlbum).toBe('function');
    expect(typeof result.current.refetch).toBe('function');

    // Wait for async initialization to complete
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
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
    const albumData = [
      {
        id: 'album-1',
        name: 'Zebra Album',
        coverPhotoId: null,
        albumType: 'custom'
      },
      {
        id: 'album-2',
        name: 'Alpha Album',
        coverPhotoId: 'photo-1',
        albumType: 'custom'
      }
    ];
    const photoLinks = [
      { parentId: 'album-1' },
      { parentId: 'album-1' },
      { parentId: 'album-2' }
    ];
    // Reset mock to clear beforeEach setup and set up fresh sequence
    mockWhere.mockReset();
    // Set up mocks to always return the album data (multiple fetches may occur)
    mockWhere
      .mockResolvedValueOnce([{ id: 'photoroll-id' }]) // System album check
      .mockResolvedValueOnce(albumData) // First fetch - albums
      .mockResolvedValueOnce(photoLinks) // First fetch - counts
      .mockResolvedValueOnce(albumData) // Second fetch - albums (from needsFetch effect)
      .mockResolvedValueOnce(photoLinks) // Second fetch - counts
      .mockResolvedValue([]); // Default for any additional calls

    const { result } = renderHook(() => usePhotoAlbums());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    // Albums should be sorted alphabetically (custom albums only)
    expect(result.current.albums.length).toBe(2);
    const firstAlbum = result.current.albums[0];
    const secondAlbum = result.current.albums[1];
    if (!firstAlbum || !secondAlbum) throw new Error('Albums not found');
    expect(firstAlbum.name).toBe('Alpha Album');
    expect(secondAlbum.name).toBe('Zebra Album');

    // Photo counts should be calculated
    expect(firstAlbum.photoCount).toBe(1); // Alpha has 1 photo
    expect(secondAlbum.photoCount).toBe(2); // Zebra has 2 photos
  });

  it('handles albums with no name', async () => {
    const albumData = [
      { id: 'album-1', name: null, coverPhotoId: null, albumType: 'custom' }
    ];
    // Reset mock and set up fresh sequence
    mockWhere.mockReset();
    mockWhere
      .mockResolvedValueOnce([{ id: 'photoroll-id' }]) // System album check
      .mockResolvedValueOnce(albumData) // First fetch - albums
      .mockResolvedValueOnce([]) // First fetch - counts
      .mockResolvedValueOnce(albumData) // Second fetch - albums
      .mockResolvedValueOnce([]) // Second fetch - counts
      .mockResolvedValue([]); // Default for any additional calls

    const { result } = renderHook(() => usePhotoAlbums());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    const album = result.current.albums[0];
    if (!album) throw new Error('Album not found');
    expect(album.name).toBe('Unnamed Album');
  });

  it('excludes deleted files from photo counts', async () => {
    const albumData = [
      {
        id: 'album-1',
        name: 'My Album',
        coverPhotoId: null,
        albumType: 'custom'
      }
    ];
    const photoLinks = [{ parentId: 'album-1' }, { parentId: 'album-1' }];
    // Reset mock and set up fresh sequence
    mockWhere.mockReset();
    mockWhere
      .mockResolvedValueOnce([{ id: 'photoroll-id' }]) // System album check
      .mockResolvedValueOnce(albumData) // First fetch - albums
      .mockResolvedValueOnce(photoLinks) // First fetch - counts
      .mockResolvedValueOnce(albumData) // Second fetch - albums
      .mockResolvedValueOnce(photoLinks) // Second fetch - counts
      .mockResolvedValue([]); // Default for any additional calls

    const { result } = renderHook(() => usePhotoAlbums());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    // Count query should go through innerJoin (to join files table)
    expect(mockInnerJoin).toHaveBeenCalled();

    const album = result.current.albums[0];
    if (!album) throw new Error('Album not found');
    expect(album.photoCount).toBe(2);
  });

  it('handles fetch error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Reset mock and set up fresh sequence
    mockWhere.mockReset();
    // System album check succeeds, then all album fetches fail
    mockWhere
      .mockResolvedValueOnce([{ id: 'photoroll-id' }]) // System album check succeeds
      .mockRejectedValue(new Error('Database error')); // All subsequent queries fail

    const { result } = renderHook(() => usePhotoAlbums());

    await waitFor(() => {
      expect(result.current.error).toBe('Database error');
    });

    consoleSpy.mockRestore();
  });

  it('ignores transient database-not-initialized errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Reset and set up: first for system album check, second for fetch (which fails transiently)
    mockWhere
      .mockResolvedValueOnce([{ id: 'photoroll-id' }]) // System album check succeeds
      .mockResolvedValueOnce([]) // Allow first fetch query
      .mockRejectedValue(new Error('Database not initialized')); // Transient error

    const { result } = renderHook(() => usePhotoAlbums());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('handles non-Error objects in catch', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Reset mock and set up fresh sequence
    mockWhere.mockReset();
    // System album check succeeds, then all album fetches fail with string
    mockWhere
      .mockResolvedValueOnce([{ id: 'photoroll-id' }]) // System album check succeeds
      .mockRejectedValue('String error'); // All subsequent queries fail with string

    const { result } = renderHook(() => usePhotoAlbums());

    await waitFor(() => {
      expect(result.current.error).toBe('String error');
    });

    consoleSpy.mockRestore();
  });
});
