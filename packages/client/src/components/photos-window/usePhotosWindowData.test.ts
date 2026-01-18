import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePhotosWindowData } from './usePhotosWindowData';

const mockDatabaseState = {
  isUnlocked: true,
  isLoading: false,
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
const mockIsFileStorageInitialized = vi.fn();
const mockInitializeFileStorage = vi.fn();
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
  initializeFileStorage: (encryptionKey: Uint8Array, instanceId: string) =>
    mockInitializeFileStorage(encryptionKey, instanceId),
  getFileStorage: () => ({
    retrieve: mockRetrieve
  })
}));

describe('usePhotosWindowData', () => {
  const photoRows = [
    {
      id: 'photo-1',
      name: 'photo.jpg',
      size: 1024,
      mimeType: 'image/jpeg',
      uploadDate: new Date('2024-01-01T00:00:00Z'),
      storagePath: '/photos/photo.jpg',
      thumbnailPath: null
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockOrderBy.mockResolvedValue(photoRows);
    mockRetrieve.mockResolvedValue(new ArrayBuffer(8));
    mockIsFileStorageInitialized.mockReturnValue(false);
    const url = globalThis.URL;
    if (url) {
      createObjectUrlSpy = vi.fn(() => 'blob:photo');
      revokeObjectUrlSpy = vi.fn();
      Object.defineProperty(url, 'createObjectURL', {
        value: createObjectUrlSpy,
        writable: true
      });
      Object.defineProperty(url, 'revokeObjectURL', {
        value: revokeObjectUrlSpy,
        writable: true
      });
    }
  });

  it('loads photos and exposes object URLs', async () => {
    const { result, unmount } = renderHook(() =>
      usePhotosWindowData({ refreshToken: 0 })
    );

    await waitFor(() => {
      expect(result.current.photos).toHaveLength(1);
    });

    expect(result.current.photos[0]?.objectUrl).toBe('blob:photo');
    expect(mockInitializeFileStorage).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'instance-1'
    );
    unmount();
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:photo');
  });

  it('sets error when fetch fails', async () => {
    mockOrderBy.mockRejectedValueOnce(new Error('Database error'));

    const { result } = renderHook(() =>
      usePhotosWindowData({ refreshToken: 0 })
    );

    await waitFor(() => {
      expect(result.current.error).toBe('Database error');
    });
  });

  it('prefers thumbnails and skips failed loads', async () => {
    mockIsFileStorageInitialized.mockReturnValue(true);
    mockOrderBy.mockResolvedValue([
      {
        id: 'photo-1',
        name: 'photo.jpg',
        size: 1024,
        mimeType: 'image/png',
        uploadDate: new Date('2024-01-01T00:00:00Z'),
        storagePath: '/photos/photo.jpg',
        thumbnailPath: '/photos/thumb.jpg'
      },
      {
        id: 'photo-2',
        name: 'broken.jpg',
        size: 2048,
        mimeType: 'image/jpeg',
        uploadDate: new Date('2024-01-02T00:00:00Z'),
        storagePath: '/photos/broken.jpg',
        thumbnailPath: null
      }
    ]);
    mockRetrieve.mockImplementation((path: string) => {
      if (path === '/photos/thumb.jpg') {
        return Promise.resolve(new ArrayBuffer(8));
      }
      return Promise.reject(new Error('Load failed'));
    });

    const { result } = renderHook(() =>
      usePhotosWindowData({ refreshToken: 1 })
    );

    await waitFor(() => {
      expect(result.current.photos).toHaveLength(1);
    });

    expect(mockRetrieve).toHaveBeenCalledWith('/photos/thumb.jpg');
    expect(mockRetrieve).toHaveBeenCalledWith('/photos/broken.jpg');
    expect(mockInitializeFileStorage).not.toHaveBeenCalled();
  });
});
