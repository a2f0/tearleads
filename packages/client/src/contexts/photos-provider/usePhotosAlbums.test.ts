import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePhotosAlbums } from './usePhotosAlbums';

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn()
};

vi.mock('@/db', () => ({
  getDatabase: () => mockDb
}));

function queueSelectResult(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn()
  };
  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockResolvedValue(rows);
  mockDb.select.mockReturnValueOnce(chain);
}

describe('usePhotosAlbums', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('generated-id');
  });

  it('returns empty albums when none exist', async () => {
    queueSelectResult([]);

    const { result } = renderHook(() => usePhotosAlbums());
    const albums = await result.current.fetchAlbums();

    expect(albums).toEqual([]);
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });

  it('fetches albums, computes counts, and sorts system albums first', async () => {
    queueSelectResult([
      {
        id: 'custom-1',
        name: 'Zeta',
        coverPhotoId: null,
        albumType: 'custom'
      },
      {
        id: 'system-1',
        name: 'Camera Roll',
        coverPhotoId: 'cover-1',
        albumType: 'photoroll'
      }
    ]);
    queueSelectResult([
      { parentId: 'custom-1' },
      { parentId: 'custom-1' },
      { parentId: 'system-1' }
    ]);

    const { result } = renderHook(() => usePhotosAlbums());
    const albums = await result.current.fetchAlbums();

    expect(albums).toEqual([
      {
        id: 'system-1',
        name: 'Camera Roll',
        photoCount: 1,
        coverPhotoId: 'cover-1',
        albumType: 'photoroll'
      },
      {
        id: 'custom-1',
        name: 'Zeta',
        photoCount: 2,
        coverPhotoId: null,
        albumType: 'custom'
      }
    ]);
  });

  it('skips insert when photo is already linked to album', async () => {
    queueSelectResult([{ id: 'existing-link' }]);

    const { result } = renderHook(() => usePhotosAlbums());
    await result.current.addPhotoToAlbum('album-1', 'photo-1');

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('creates a link when photo is not yet in album', async () => {
    queueSelectResult([]);

    const values = vi.fn().mockResolvedValue(undefined);
    mockDb.insert.mockReturnValue({ values });

    const { result } = renderHook(() => usePhotosAlbums());
    await result.current.addPhotoToAlbum('album-1', 'photo-1');

    expect(mockDb.insert).toHaveBeenCalled();
    expect(values).toHaveBeenCalledTimes(1);
  });
});
