import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyManager } from '@/db/crypto/key-manager';
import * as schema from '@/db/schema';
import type { FileStorage } from '@/storage/opfs';
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

const createMockDatabase = () =>
  drizzle(async () => ({ rows: [] }), { schema });

const createFileStorage = (
  measureRetrieve: FileStorage['measureRetrieve']
): FileStorage => ({
  instanceId: 'instance-1',
  initialize: vi.fn(async () => {}),
  store: vi.fn(async () => 'path'),
  measureStore: vi.fn(async () => 'path'),
  retrieve: vi.fn(async () => new Uint8Array()),
  measureRetrieve,
  delete: vi.fn(async () => {}),
  exists: vi.fn(async () => true),
  getStorageUsed: vi.fn(async () => 0),
  clearAll: vi.fn(async () => {})
});

describe('retrieveFileData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when no encryption key is available', async () => {
    const keyManager = new KeyManager('instance-1');
    Object.defineProperty(keyManager, 'currentKey', {
      value: null,
      writable: true
    });
    vi.mocked(getKeyManager).mockReturnValue(keyManager);

    await expect(
      retrieveFileData('/files/test.txt', 'instance-1')
    ).rejects.toThrow('Database not unlocked');
  });

  it('initializes storage when needed and measures retrieval', async () => {
    const mockKey = new Uint8Array([1, 2, 3]);
    const measureRetrieve = vi.fn(async () => new Uint8Array([9, 8, 7]));
    const db = createMockDatabase();

    const keyManager = new KeyManager('instance-1');
    Object.defineProperty(keyManager, 'currentKey', {
      value: mockKey,
      writable: true
    });
    vi.mocked(getKeyManager).mockReturnValue(keyManager);
    vi.mocked(isFileStorageInitialized).mockReturnValue(false);
    vi.mocked(getFileStorage).mockReturnValue(
      createFileStorage(measureRetrieve)
    );
    vi.mocked(getDatabase).mockReturnValue(db);

    const data = await retrieveFileData('/files/test.txt', 'instance-1');

    expect(initializeFileStorage).toHaveBeenCalledWith(mockKey, 'instance-1');
    expect(createRetrieveLogger).toHaveBeenCalledWith(db);
    expect(data).toEqual(new Uint8Array([9, 8, 7]));
  });

  it('skips initialization when storage is already ready', async () => {
    const mockKey = new Uint8Array([4, 5, 6]);
    const measureRetrieve = vi.fn(async () => new Uint8Array([1]));

    const keyManager = new KeyManager('instance-1');
    Object.defineProperty(keyManager, 'currentKey', {
      value: mockKey,
      writable: true
    });
    vi.mocked(getKeyManager).mockReturnValue(keyManager);
    vi.mocked(isFileStorageInitialized).mockReturnValue(true);
    vi.mocked(getFileStorage).mockReturnValue(
      createFileStorage(measureRetrieve)
    );

    await retrieveFileData('/files/test.txt', 'instance-1');

    expect(initializeFileStorage).not.toHaveBeenCalled();
  });
});
