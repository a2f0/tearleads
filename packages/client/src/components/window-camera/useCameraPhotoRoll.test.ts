import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCameraPhotoRoll } from './useCameraPhotoRoll';

const mockDatabaseState: {
  isUnlocked: boolean;
  currentInstanceId: string | null;
} = {
  isUnlocked: true,
  currentInstanceId: 'instance-1'
};

const mockOrderBy = vi.fn();
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: mockOrderBy
};

const mockRetrieve = vi.fn();
const mockIsFileStorageInitialized = vi.fn().mockReturnValue(true);
let createObjectUrlSpy = vi.fn();
let revokeObjectUrlSpy = vi.fn();

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockDatabaseState
}));

vi.mock('@/db', () => ({
  getDatabase: () => mockDb
}));

vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({
    getCurrentKey: () => new Uint8Array(32)
  })
}));

vi.mock('@/storage/opfs', () => ({
  isFileStorageInitialized: (instanceId?: string) =>
    mockIsFileStorageInitialized(instanceId),
  initializeFileStorage: vi.fn(),
  getFileStorage: () => ({
    retrieve: mockRetrieve
  })
}));

const mockGetPhotoRollAlbum = vi.fn();

vi.mock('@/components/window-photos/usePhotoAlbums', () => ({
  usePhotoAlbums: () => ({
    getPhotoRollAlbum: mockGetPhotoRollAlbum,
    hasFetched: true,
    albums: []
  })
}));

describe('useCameraPhotoRoll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabaseState.isUnlocked = true;
    mockDatabaseState.currentInstanceId = 'instance-1';

    createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(
        (_blob: Blob) => `blob:mock-${Math.random().toString(36).slice(2)}`
      );
    revokeObjectUrlSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);
  });

  it('returns empty photos when database is not unlocked', () => {
    mockDatabaseState.isUnlocked = false;

    const { result } = renderHook(() => useCameraPhotoRoll());

    expect(result.current.photos).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('returns empty photos when no photo roll album exists', async () => {
    mockGetPhotoRollAlbum.mockReturnValue(undefined);

    const { result } = renderHook(() => useCameraPhotoRoll());

    await waitFor(() => {
      expect(result.current.photos).toEqual([]);
    });
  });

  it('loads photos from the photo roll album', async () => {
    mockGetPhotoRollAlbum.mockReturnValue({
      id: 'album-1',
      name: 'Photo Roll'
    });

    // First query: vfsLinks for album children
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi
          .fn()
          .mockResolvedValue([{ childId: 'photo-1' }, { childId: 'photo-2' }])
      })
    });

    // Second query: files
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([
            {
              id: 'photo-1',
              mimeType: 'image/jpeg',
              storagePath: '/photos/1.jpg',
              thumbnailPath: '/thumbs/1.jpg'
            },
            {
              id: 'photo-2',
              mimeType: 'image/png',
              storagePath: '/photos/2.png',
              thumbnailPath: null
            }
          ])
        })
      })
    });

    mockRetrieve.mockResolvedValue(new ArrayBuffer(10));

    const { result } = renderHook(() => useCameraPhotoRoll());

    await waitFor(() => {
      expect(result.current.photos).toHaveLength(2);
    });

    expect(result.current.photos[0].id).toBe('photo-1');
    expect(result.current.photos[1].id).toBe('photo-2');
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(2);
  });

  it('returns empty array when album has no photos', async () => {
    mockGetPhotoRollAlbum.mockReturnValue({
      id: 'album-1',
      name: 'Photo Roll'
    });

    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([])
      })
    });

    const { result } = renderHook(() => useCameraPhotoRoll());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.photos).toEqual([]);
  });

  it('revokes object URLs on unmount', async () => {
    mockGetPhotoRollAlbum.mockReturnValue({
      id: 'album-1',
      name: 'Photo Roll'
    });

    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ childId: 'photo-1' }])
      })
    });

    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([
            {
              id: 'photo-1',
              mimeType: 'image/jpeg',
              storagePath: '/photos/1.jpg',
              thumbnailPath: '/thumbs/1.jpg'
            }
          ])
        })
      })
    });

    mockRetrieve.mockResolvedValue(new ArrayBuffer(10));

    const { result, unmount } = renderHook(() => useCameraPhotoRoll());

    await waitFor(() => {
      expect(result.current.photos).toHaveLength(1);
    });

    unmount();

    expect(revokeObjectUrlSpy).toHaveBeenCalled();
  });
});
