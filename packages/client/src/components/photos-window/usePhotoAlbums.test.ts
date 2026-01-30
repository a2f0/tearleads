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
});
