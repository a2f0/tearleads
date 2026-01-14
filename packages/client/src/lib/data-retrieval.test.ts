import { beforeEach, describe, expect, it, vi } from 'vitest';
import { retrieveFileData } from './data-retrieval';

vi.mock('@/db', () => ({
  getDatabase: vi.fn(() => ({ id: 'db' }))
}));

vi.mock('@/db/crypto', () => ({
  getKeyManager: vi.fn()
}));

vi.mock('@/storage/opfs', () => ({
  createRetrieveLogger: vi.fn(() => vi.fn()),
  getFileStorage: vi.fn(),
  initializeFileStorage: vi.fn(),
  isFileStorageInitialized: vi.fn()
}));

import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import {
  createRetrieveLogger,
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';

describe('retrieveFileData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when no encryption key is available', async () => {
    vi.mocked(getKeyManager).mockReturnValue({
      getCurrentKey: () => null
    });

    await expect(
      retrieveFileData('/files/test.txt', 'instance-1')
    ).rejects.toThrow('Database not unlocked');
  });

  it('initializes storage when needed and measures retrieval', async () => {
    const mockKey = new Uint8Array([1, 2, 3]);
    const measureRetrieve = vi.fn(async () => new Uint8Array([9, 8, 7]));
    const db = { id: 'db' };

    vi.mocked(getKeyManager).mockReturnValue({
      getCurrentKey: () => mockKey
    });
    vi.mocked(isFileStorageInitialized).mockReturnValue(false);
    vi.mocked(getFileStorage).mockReturnValue({ measureRetrieve });
    vi.mocked(getDatabase).mockReturnValue(db);

    const data = await retrieveFileData('/files/test.txt', 'instance-1');

    expect(initializeFileStorage).toHaveBeenCalledWith(mockKey, 'instance-1');
    expect(createRetrieveLogger).toHaveBeenCalledWith(db);
    expect(data).toEqual(new Uint8Array([9, 8, 7]));
  });

  it('skips initialization when storage is already ready', async () => {
    const mockKey = new Uint8Array([4, 5, 6]);
    const measureRetrieve = vi.fn(async () => new Uint8Array([1]));

    vi.mocked(getKeyManager).mockReturnValue({
      getCurrentKey: () => mockKey
    });
    vi.mocked(isFileStorageInitialized).mockReturnValue(true);
    vi.mocked(getFileStorage).mockReturnValue({ measureRetrieve });

    await retrieveFileData('/files/test.txt', 'instance-1');

    expect(initializeFileStorage).not.toHaveBeenCalled();
  });
});
