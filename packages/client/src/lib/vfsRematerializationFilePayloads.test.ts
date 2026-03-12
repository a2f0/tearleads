import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/consoleMocks';

const mockGetCurrentInstanceId = vi.fn(() => 'test-instance');
const mockGetCurrentKey = vi.fn(() => new Uint8Array([1, 2, 3]));
const mockInitializeFileStorage = vi.fn(async () => {});
const mockIsFileStorageInitialized = vi.fn(() => true);
const mockStore = vi.fn(async (id: string) => `${id}.enc`);
const mockLogError = vi.fn();

vi.mock('@/db', () => ({
  getCurrentInstanceId: () => mockGetCurrentInstanceId()
}));

vi.mock('@/db/crypto', () => ({
  getKeyManagerForInstance: () => ({
    getCurrentKey: () => mockGetCurrentKey()
  })
}));

vi.mock('@/storage/opfs', () => ({
  initializeFileStorage: (...args: unknown[]) =>
    mockInitializeFileStorage(...args),
  isFileStorageInitialized: (...args: unknown[]) =>
    mockIsFileStorageInitialized(...args),
  getFileStorageForInstance: () => ({
    store: (...args: unknown[]) => mockStore(...args)
  })
}));

vi.mock('@/stores/logStore', () => ({
  logStore: {
    error: (...args: unknown[]) => mockLogError(...args)
  }
}));

import { materializeFilePayloadsToStorage } from './vfsRematerializationFilePayloads';

describe('materializeFilePayloadsToStorage', () => {
  let restoreConsoleError: (() => void) | null = null;

  beforeEach(() => {
    restoreConsoleError?.();
    restoreConsoleError = mockConsoleError();
    vi.clearAllMocks();
    mockGetCurrentInstanceId.mockReturnValue('test-instance');
    mockGetCurrentKey.mockReturnValue(new Uint8Array([1, 2, 3]));
    mockIsFileStorageInitialized.mockReturnValue(true);
    mockStore.mockImplementation(async (id: string) => `${id}.enc`);
  });

  afterEach(() => {
    restoreConsoleError?.();
    restoreConsoleError = null;
  });

  it('logs an error when a non-deleted file has no payload', async () => {
    await materializeFilePayloadsToStorage(
      [
        {
          id: 'photo-item',
          storagePath: 'rematerialized-photo-item.enc',
          deleted: false
        }
      ],
      new Map()
    );

    expect(mockLogError).toHaveBeenCalledWith(
      'VFS rematerialization payload missing',
      expect.stringContaining('itemId=photo-item')
    );
    expect(mockStore).not.toHaveBeenCalled();
  });

  it('logs an error when payload decoding fails', async () => {
    await materializeFilePayloadsToStorage(
      [
        {
          id: 'audio-item',
          storagePath: 'rematerialized-audio-item.enc',
          deleted: false
        }
      ],
      new Map([
        [
          'audio-item',
          {
            encryptedPayload: '%%%not-base64%%%',
            updatedAtMs: Date.now(),
            deleted: false
          }
        ]
      ])
    );

    expect(mockLogError).toHaveBeenCalledWith(
      'VFS rematerialization payload decode failed',
      expect.stringContaining('itemId=audio-item')
    );
    expect(mockStore).not.toHaveBeenCalled();
  });

  it('stores valid payloads without logging errors', async () => {
    const payload = Buffer.from('abc', 'utf8').toString('base64');
    const fileRows = [
      {
        id: 'file-item',
        storagePath: 'rematerialized-file-item.enc',
        deleted: false
      }
    ];

    await materializeFilePayloadsToStorage(
      fileRows,
      new Map([
        [
          'file-item',
          {
            encryptedPayload: payload,
            updatedAtMs: Date.now(),
            deleted: false
          }
        ]
      ])
    );

    expect(mockStore).toHaveBeenCalledTimes(1);
    expect(mockLogError).not.toHaveBeenCalled();
    expect(fileRows[0]?.storagePath).toBe('rematerialized-file-item.enc');
  });

  it('accepts line-wrapped base64 payloads from sync feeds', async () => {
    const payload = Buffer.from('line wrapped payload', 'utf8').toString(
      'base64'
    );
    const wrappedPayload = `${payload.slice(0, 8)}\n${payload.slice(8)}`;
    const fileRows = [
      {
        id: 'wrapped-item',
        storagePath: 'rematerialized-wrapped-item.enc',
        deleted: false
      }
    ];

    await materializeFilePayloadsToStorage(
      fileRows,
      new Map([
        [
          'wrapped-item',
          {
            encryptedPayload: wrappedPayload,
            updatedAtMs: Date.now(),
            deleted: false
          }
        ]
      ])
    );

    expect(mockStore).toHaveBeenCalledTimes(1);
    expect(mockLogError).not.toHaveBeenCalled();
    expect(fileRows[0]?.storagePath).toBe('rematerialized-wrapped-item.enc');
  });
});
