import { act } from '@testing-library/react';
import type { VfsCrdtSyncItem } from '@tearleads/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateVfsBlobDownloadFlusher = vi.fn();
const mockCreateVfsCryptoEngine = vi.fn();
const mockCreateVfsSecureReadPipeline = vi.fn();
const mockGetDatabase = vi.fn();
const mockGetKeyManager = vi.fn();
const mockLoadVfsBlobDownloadState = vi.fn();
const mockSaveVfsBlobDownloadState = vi.fn();
const mockCreateItemKeyStore = vi.fn();
const mockGetBlobManifest = vi.fn();
const mockGetBlobChunk = vi.fn();
const mockGetCrdtSync = vi.fn();
const mockCreateStoreLogger = vi.fn();
const mockGetOrInitializeFileStorage = vi.fn();
const mockResetVfsBlobDownloadOperations = vi.fn();
const mockSetVfsBlobDownloadOperations = vi.fn();

vi.mock('@tearleads/api-client/clientEntry', () => ({
  createVfsBlobDownloadFlusher: (...args: unknown[]) =>
    mockCreateVfsBlobDownloadFlusher(...args),
  createVfsCryptoEngine: (...args: unknown[]) =>
    mockCreateVfsCryptoEngine(...args),
  createVfsSecureReadPipeline: (...args: unknown[]) =>
    mockCreateVfsSecureReadPipeline(...args)
}));

vi.mock('@/db', () => ({
  getDatabase: () => mockGetDatabase()
}));

vi.mock('@/db/crypto', () => ({
  getKeyManager: () => mockGetKeyManager()
}));

vi.mock('@/db/vfsBlobDownloadState', () => ({
  loadVfsBlobDownloadState: (...args: unknown[]) =>
    mockLoadVfsBlobDownloadState(...args),
  saveVfsBlobDownloadState: (...args: unknown[]) =>
    mockSaveVfsBlobDownloadState(...args)
}));

vi.mock('@/db/vfsItemKeys', () => ({
  createItemKeyStore: (...args: unknown[]) => mockCreateItemKeyStore(...args)
}));

vi.mock('@/lib/api', () => ({
  api: {
    vfs: {
      getBlobManifest: (...args: unknown[]) => mockGetBlobManifest(...args),
      getBlobChunk: (...args: unknown[]) => mockGetBlobChunk(...args),
      getCrdtSync: (...args: unknown[]) => mockGetCrdtSync(...args)
    }
  }
}));

vi.mock('@/storage/opfs', () => ({
  createStoreLogger: (...args: unknown[]) => mockCreateStoreLogger(...args),
  getOrInitializeFileStorage: (...args: unknown[]) =>
    mockGetOrInitializeFileStorage(...args)
}));

vi.mock('./vfsBlobDownloadStore', () => ({
  resetVfsBlobDownloadOperations: (...args: unknown[]) =>
    mockResetVfsBlobDownloadOperations(...args),
  setVfsBlobDownloadOperations: (...args: unknown[]) =>
    mockSetVfsBlobDownloadOperations(...args)
}));

import {
  createVfsBlobDownloadSync,
  discoverPendingBlobDownloads,
  fetchAllCrdtSyncItems
} from './vfsBlobDownloadSync';

function createCrdtItem(
  input: Partial<VfsCrdtSyncItem> & Pick<VfsCrdtSyncItem, 'itemId' | 'opId'>
): VfsCrdtSyncItem {
  return {
    opId: input.opId,
    itemId: input.itemId,
    opType: input.opType ?? 'item_upsert',
    principalType: null,
    principalId: null,
    accessLevel: null,
    parentId: null,
    childId: null,
    actorId: null,
    sourceTable: input.sourceTable ?? 'vfs_crdt_ops',
    sourceId: input.sourceId ?? input.opId,
    occurredAt: input.occurredAt ?? '2026-03-14T00:00:00.000Z',
    ...(input.blobId ? { blobId: input.blobId } : {}),
    ...(input.blobSizeBytes ? { blobSizeBytes: input.blobSizeBytes } : {}),
    ...(input.blobRelationKind
      ? { blobRelationKind: input.blobRelationKind }
      : {})
  };
}

describe('vfsBlobDownloadSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetDatabase.mockReturnValue({ name: 'db' });
    mockGetKeyManager.mockReturnValue({
      getCurrentKey: () => new Uint8Array([1, 2, 3])
    });
    mockCreateItemKeyStore.mockReturnValue({
      getItemKey: vi.fn().mockResolvedValue({
        sessionKey: new Uint8Array([9, 9, 9])
      })
    });
    mockCreateVfsCryptoEngine.mockReturnValue({ name: 'engine' });
    mockCreateVfsSecureReadPipeline.mockReturnValue({
      decryptEncryptedBlob: vi.fn().mockResolvedValue(new Uint8Array([7, 8]))
    });
    mockCreateStoreLogger.mockReturnValue({ logger: true });
    mockGetOrInitializeFileStorage.mockResolvedValue({
      exists: vi.fn().mockResolvedValue(false),
      measureStore: vi.fn().mockResolvedValue(undefined)
    });
    mockCreateVfsBlobDownloadFlusher.mockReturnValue({
      hydrateFromPersistence: vi.fn().mockResolvedValue(false),
      exportState: vi.fn().mockReturnValue({ pendingDownloads: [] }),
      dequeueForItems: vi.fn(),
      queueDownloads: vi.fn(),
      persistState: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn().mockResolvedValue(undefined)
    });
    mockLoadVfsBlobDownloadState.mockResolvedValue(null);
    mockSaveVfsBlobDownloadState.mockResolvedValue(undefined);
    mockGetCrdtSync.mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false
    });
  });

  it('fetches all CRDT feed pages until completion', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        items: [createCrdtItem({ itemId: 'item-1', opId: 'op-1' })],
        nextCursor: 'cursor-1',
        hasMore: true
      })
      .mockResolvedValueOnce({
        items: [createCrdtItem({ itemId: 'item-2', opId: 'op-2' })],
        nextCursor: null,
        hasMore: false
      });

    await expect(fetchAllCrdtSyncItems(fetchPage)).resolves.toEqual([
      createCrdtItem({ itemId: 'item-1', opId: 'op-1' }),
      createCrdtItem({ itemId: 'item-2', opId: 'op-2' })
    ]);
    expect(fetchPage).toHaveBeenNthCalledWith(1, undefined, 500);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'cursor-1', 500);
  });

  it('throws when the CRDT feed claims more pages without a next cursor', async () => {
    await expect(
      fetchAllCrdtSyncItems(async () => ({
        items: [createCrdtItem({ itemId: 'item-1', opId: 'op-1' })],
        nextCursor: null,
        hasMore: true
      }))
    ).rejects.toThrow('vfs crdt feed reported hasMore without nextCursor');
  });

  it('throws when the CRDT feed returns a non-advancing cursor', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        items: [createCrdtItem({ itemId: 'item-1', opId: 'op-1' })],
        nextCursor: 'cursor-1',
        hasMore: true
      })
      .mockResolvedValueOnce({
        items: [createCrdtItem({ itemId: 'item-2', opId: 'op-2' })],
        nextCursor: 'cursor-1',
        hasMore: true
      });

    await expect(fetchAllCrdtSyncItems(fetchPage)).rejects.toThrow(
      'vfs crdt feed returned a non-advancing cursor: cursor-1'
    );
  });

  it('keeps only latest live blob refs and skips blobs already stored locally', async () => {
    const existsLocal = vi.fn(
      async (blobId: string) => blobId === 'blob-local'
    );
    const items = [
      createCrdtItem({
        itemId: 'item-1',
        opId: 'op-1',
        blobId: 'blob-old',
        blobSizeBytes: 64,
        blobRelationKind: 'file'
      }),
      createCrdtItem({
        itemId: 'item-2',
        opId: 'op-2',
        blobId: 'blob-deleted',
        blobSizeBytes: 32,
        blobRelationKind: 'file'
      }),
      createCrdtItem({
        itemId: 'item-1',
        opId: 'op-3',
        blobId: 'blob-live',
        blobSizeBytes: 128,
        blobRelationKind: 'file'
      }),
      createCrdtItem({
        itemId: 'item-2',
        opId: 'op-4',
        opType: 'item_delete'
      }),
      createCrdtItem({
        itemId: 'item-3',
        opId: 'op-5',
        blobId: 'blob-local',
        blobSizeBytes: 256,
        blobRelationKind: 'file'
      })
    ];

    const result = await discoverPendingBlobDownloads(items, existsLocal);

    expect(result.deletedItemIds).toEqual(new Set(['item-2']));
    expect(result.operations).toEqual([
      {
        operationId: 'download:blob-live',
        blobId: 'blob-live',
        itemId: 'item-1',
        sizeBytes: 128
      }
    ]);
    expect(existsLocal).toHaveBeenCalledWith('blob-live');
    expect(existsLocal).toHaveBeenCalledWith('blob-local');
  });

  it('ignores invalid sizes and duplicate blob ids during discovery', async () => {
    const existsLocal = vi.fn().mockResolvedValue(false);
    const items = [
      createCrdtItem({
        itemId: 'item-1',
        opId: 'op-1',
        blobId: 'blob-1',
        blobSizeBytes: 64
      }),
      createCrdtItem({
        itemId: 'item-2',
        opId: 'op-2',
        blobId: 'blob-1',
        blobSizeBytes: 128
      }),
      createCrdtItem({
        itemId: 'item-3',
        opId: 'op-3',
        blobId: 'blob-3'
      }),
      createCrdtItem({
        itemId: 'item-4',
        opId: 'op-4',
        blobId: 'blob-4',
        blobSizeBytes: 0
      })
    ];

    const result = await discoverPendingBlobDownloads(items, existsLocal);

    expect(result.deletedItemIds).toEqual(new Set());
    expect(result.operations).toEqual([
      {
        operationId: 'download:blob-1',
        blobId: 'blob-1',
        itemId: 'item-1',
        sizeBytes: 64
      }
    ]);
  });

  it('hydrates persisted downloads into the store when active', async () => {
    const pendingDownloads = [
      {
        operationId: 'download:blob-1',
        blobId: 'blob-1',
        itemId: 'item-1',
        sizeBytes: 128
      }
    ];
    const flusher = {
      hydrateFromPersistence: vi.fn().mockResolvedValue(true),
      exportState: vi.fn().mockReturnValue({ pendingDownloads }),
      dequeueForItems: vi.fn(),
      queueDownloads: vi.fn(),
      persistState: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn().mockResolvedValue(undefined)
    };
    mockCreateVfsBlobDownloadFlusher.mockReturnValueOnce(flusher);

    const sync = createVfsBlobDownloadSync({
      instanceId: 'instance-1',
      userId: 'user-1'
    });

    await expect(sync.hydrateFromPersistence()).resolves.toBe(true);
    expect(mockResetVfsBlobDownloadOperations).toHaveBeenCalledTimes(1);
    expect(mockSetVfsBlobDownloadOperations).toHaveBeenCalledWith(
      pendingDownloads
    );
  });

  it('skips hydration and persistence updates when inactive', async () => {
    const flusher = {
      hydrateFromPersistence: vi.fn().mockResolvedValue(true),
      exportState: vi.fn().mockReturnValue({ pendingDownloads: [] }),
      dequeueForItems: vi.fn(),
      queueDownloads: vi.fn(),
      persistState: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn().mockResolvedValue(undefined)
    };
    mockCreateVfsBlobDownloadFlusher.mockReturnValueOnce(flusher);

    const sync = createVfsBlobDownloadSync({
      instanceId: 'instance-1',
      userId: 'user-1',
      isActive: () => false
    });

    await expect(sync.hydrateFromPersistence()).resolves.toBe(false);
    expect(flusher.hydrateFromPersistence).not.toHaveBeenCalled();

    const options = mockCreateVfsBlobDownloadFlusher.mock.calls[0]?.[0];
    if (!options) {
      throw new Error('flusher options not captured');
    }

    await expect(
      options.saveState({
        pendingDownloads: []
      })
    ).resolves.toBeUndefined();
    expect(mockSaveVfsBlobDownloadState).not.toHaveBeenCalled();
  });

  it('wires flusher callbacks to persistence and file storage dependencies', async () => {
    const storage = {
      exists: vi.fn().mockResolvedValue(true),
      measureStore: vi.fn().mockResolvedValue(undefined)
    };
    mockGetOrInitializeFileStorage.mockResolvedValue(storage);
    mockLoadVfsBlobDownloadState.mockResolvedValue(Promise.resolve);

    createVfsBlobDownloadSync({
      instanceId: 'instance-1',
      userId: 'user-1'
    });

    const options = mockCreateVfsBlobDownloadFlusher.mock.calls[0]?.[0];
    if (!options) {
      throw new Error('flusher options not captured');
    }

    await options.loadState();
    expect(mockLoadVfsBlobDownloadState).toHaveBeenCalledWith(
      'user-1',
      'client'
    );

    const persistedState = {
      pendingDownloads: [
        {
          operationId: 'download:blob-1',
          blobId: 'blob-1',
          itemId: 'item-1',
          sizeBytes: 128
        }
      ]
    };
    await options.saveState(persistedState);
    expect(mockSaveVfsBlobDownloadState).toHaveBeenCalledWith(
      'user-1',
      'client',
      persistedState
    );
    expect(mockSetVfsBlobDownloadOperations).toHaveBeenCalledWith(
      persistedState.pendingDownloads
    );

    await expect(options.existsLocal('blob-1')).resolves.toBe(true);
    expect(storage.exists).toHaveBeenCalledWith('blob-1.enc');

    const data = new Uint8Array([1, 2, 3]);
    await options.storeLocal('blob-1', data);
    expect(storage.measureStore).toHaveBeenCalledWith(
      'blob-1',
      data,
      { logger: true }
    );
  });

  it('throws from file storage callbacks when the database is locked', async () => {
    mockGetKeyManager.mockReturnValue({
      getCurrentKey: () => null
    });

    createVfsBlobDownloadSync({
      instanceId: 'instance-1',
      userId: 'user-1'
    });

    const options = mockCreateVfsBlobDownloadFlusher.mock.calls[0]?.[0];
    if (!options) {
      throw new Error('flusher options not captured');
    }

    await expect(options.existsLocal('blob-1')).rejects.toThrow(
      'Database not unlocked'
    );
    await expect(options.storeLocal('blob-1', new Uint8Array([1]))).rejects.toThrow(
      'Database not unlocked'
    );
  });

  it('deduplicates concurrent sync calls and updates the store after flush', async () => {
    const pendingDownloads = [
      {
        operationId: 'download:blob-1',
        blobId: 'blob-1',
        itemId: 'item-1',
        sizeBytes: 128
      }
    ];
    const flusher = {
      hydrateFromPersistence: vi.fn().mockResolvedValue(false),
      exportState: vi.fn().mockReturnValue({ pendingDownloads }),
      dequeueForItems: vi.fn(),
      queueDownloads: vi.fn(),
      persistState: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn().mockResolvedValue(undefined)
    };
    mockCreateVfsBlobDownloadFlusher.mockReturnValueOnce(flusher);
    mockGetCrdtSync.mockResolvedValue({
      items: [
        createCrdtItem({
          itemId: 'item-1',
          opId: 'op-1',
          blobId: 'blob-1',
          blobSizeBytes: 128
        })
      ],
      nextCursor: null,
      hasMore: false
    });

    const sync = createVfsBlobDownloadSync({
      instanceId: 'instance-1',
      userId: 'user-1'
    });

    await act(async () => {
      await Promise.all([sync.sync(), sync.sync()]);
    });

    expect(mockGetCrdtSync).toHaveBeenCalledTimes(1);
    const deletedItemIds = flusher.dequeueForItems.mock.calls[0]?.[0];
    expect(deletedItemIds).toBeInstanceOf(Set);
    expect(Array.from(deletedItemIds as Set<string>)).toEqual([]);
    expect(flusher.queueDownloads).toHaveBeenCalledWith(pendingDownloads);
    expect(flusher.persistState).toHaveBeenCalledTimes(1);
    expect(flusher.flush).toHaveBeenCalledTimes(1);
    expect(mockSetVfsBlobDownloadOperations).toHaveBeenLastCalledWith(
      pendingDownloads
    );
  });

  it('short-circuits sync when inactive', async () => {
    const sync = createVfsBlobDownloadSync({
      instanceId: 'instance-1',
      userId: 'user-1',
      isActive: () => false
    });

    await expect(sync.sync()).resolves.toBeUndefined();
    expect(mockGetCrdtSync).not.toHaveBeenCalled();
  });
});
