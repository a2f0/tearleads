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
      if (typeof url.createObjectURL !== 'function') {
        Object.defineProperty(url, 'createObjectURL', {
          value: vi.fn(() => 'blob:photo'),
          writable: true
        });
      } else {
        vi.spyOn(url, 'createObjectURL').mockReturnValue('blob:photo');
      }
      if (typeof url.revokeObjectURL !== 'function') {
        Object.defineProperty(url, 'revokeObjectURL', {
          value: vi.fn(),
          writable: true
        });
      } else {
        vi.spyOn(url, 'revokeObjectURL').mockImplementation(() => undefined);
      }
    }
  });

  it('loads photos and exposes object URLs', async () => {
    const { result } = renderHook(() =>
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
});
