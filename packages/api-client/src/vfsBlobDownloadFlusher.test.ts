import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  GetBlobChunkClientResponse,
  GetBlobManifestClientResponse
} from './apiRoutes/vfsRoutes';
import {
  createVfsBlobDownloadFlusher,
  type VfsBlobDownloadFlusher
} from './vfsBlobDownloadFlusher';
import type {
  VfsBlobDownloadFlusherPersistedState,
  VfsBlobDownloadOperation,
  VfsBlobDownloadResultEvent
} from './vfsBlobDownloadTypes';

function createOperation(
  id: number,
  overrides: Partial<VfsBlobDownloadOperation> = {}
): VfsBlobDownloadOperation {
  return {
    operationId: `op-${id}`,
    blobId: `blob-${id}`,
    itemId: `item-${id}`,
    sizeBytes: 1024,
    ...overrides
  };
}

function createManifest(
  overrides: Partial<GetBlobManifestClientResponse> = {}
): GetBlobManifestClientResponse {
  return {
    blobId: 'blob-1',
    keyEpoch: 7,
    chunkCount: 2,
    totalPlaintextBytes: 20,
    totalCiphertextBytes: 28,
    chunkHashes: ['hash-0', 'hash-1'],
    manifestHash: 'manifest-hash',
    manifestSignature: 'manifest-signature',
    contentType: 'application/octet-stream',
    ...overrides
  };
}

function createChunk(
  chunkIndex: number,
  data: number[],
  overrides: Partial<GetBlobChunkClientResponse> = {}
): GetBlobChunkClientResponse {
  return {
    chunkIndex,
    data: new Uint8Array(data),
    isFinal: chunkIndex === 1,
    plaintextLength: data.length,
    ciphertextLength: data.length + 4,
    nonce: `nonce-${chunkIndex}`,
    aadHash: `aad-${chunkIndex}`,
    ...overrides
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createFlusher(
  overrides: Partial<
    ConstructorParameters<typeof VfsBlobDownloadFlusher>[0]
  > = {}
): VfsBlobDownloadFlusher {
  return createVfsBlobDownloadFlusher({
    getBlobManifest: vi.fn(async () => createManifest()),
    getBlobChunk: vi.fn(async (_blobId: string, chunkIndex: number) =>
      createChunk(chunkIndex, [chunkIndex + 65])
    ),
    decryptBlob: vi.fn(async () => new Uint8Array([1, 2, 3])),
    storeLocal: vi.fn(async () => undefined),
    existsLocal: vi.fn(async () => false),
    ...overrides
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('vfsBlobDownloadFlusher', () => {
  it('dedupes queued downloads and exports hydrated state', async () => {
    const saveState = vi.fn(
      async (state: VfsBlobDownloadFlusherPersistedState) => state
    );
    const flusher = createFlusher({ saveState });

    flusher.queueDownloads([
      createOperation(1),
      createOperation(2, { blobId: 'blob-1', itemId: 'item-2' }),
      createOperation(3)
    ]);

    expect(flusher.exportState()).toEqual({
      pendingDownloads: [createOperation(1), createOperation(3)]
    });

    await flusher.persistState();
    expect(saveState).toHaveBeenCalledWith({
      pendingDownloads: [createOperation(1), createOperation(3)]
    });

    const hydrated = createFlusher();
    hydrated.hydrateState(flusher.exportState());
    expect(hydrated.exportState()).toEqual(flusher.exportState());
  });

  it('returns false when persistence is unavailable or empty', async () => {
    const withoutLoader = createFlusher();
    await expect(withoutLoader.hydrateFromPersistence()).resolves.toBe(false);
    await expect(withoutLoader.persistState()).resolves.toBeUndefined();

    const emptyLoader = createFlusher({
      loadState: async () => null
    });
    await expect(emptyLoader.hydrateFromPersistence()).resolves.toBe(false);
  });

  it('hydrates from persistence and dequeues matching items', async () => {
    const persistedState: VfsBlobDownloadFlusherPersistedState = {
      pendingDownloads: [
        createOperation(1),
        createOperation(2),
        createOperation(3)
      ]
    };
    const flusher = createFlusher({
      loadState: async () => persistedState
    });

    await expect(flusher.hydrateFromPersistence()).resolves.toBe(true);
    flusher.dequeueForItems(new Set(['item-2', 'missing-item']));

    expect(flusher.exportState()).toEqual({
      pendingDownloads: [createOperation(1), createOperation(3)]
    });
  });

  it('coalesces concurrent flush calls, skips cached blobs, and downloads chunks in sorted order', async () => {
    const saveSnapshots: VfsBlobDownloadFlusherPersistedState[] = [];
    const events: VfsBlobDownloadResultEvent[] = [];
    const manifestDeferred = createDeferred<GetBlobManifestClientResponse>();
    const getBlobManifest = vi.fn(async () => manifestDeferred.promise);
    const decryptBlob = vi.fn(async () => new Uint8Array([9, 8, 7]));
    const storeLocal = vi.fn(async () => undefined);

    const flusher = createFlusher({
      existsLocal: vi.fn(async (blobId: string) => blobId === 'blob-1'),
      getBlobManifest,
      getBlobChunk: vi.fn(async (_blobId: string, chunkIndex: number) => {
        if (chunkIndex === 0) {
          return createChunk(1, [66], { isFinal: true });
        }
        return createChunk(0, [65], { isFinal: false });
      }),
      decryptBlob,
      storeLocal,
      saveState: async (state) => {
        saveSnapshots.push(structuredClone(state));
      },
      onOperationResult: async (event) => {
        events.push(event);
      }
    });

    flusher.queueDownloads([
      createOperation(1),
      createOperation(2, { blobId: 'blob-2', itemId: 'item-2' })
    ]);

    const flushes = Promise.all([flusher.flush(), flusher.flush()]);

    manifestDeferred.resolve(
      createManifest({
        blobId: 'blob-2',
        chunkCount: 2,
        totalPlaintextBytes: 2,
        totalCiphertextBytes: 10
      })
    );

    await expect(flushes).resolves.toEqual([
      {
        processedDownloads: 2,
        pendingDownloads: 0,
        skippedAlreadyCached: 1
      },
      {
        processedDownloads: 2,
        pendingDownloads: 0,
        skippedAlreadyCached: 1
      }
    ]);

    expect(saveSnapshots).toEqual([
      {
        pendingDownloads: [
          createOperation(2, { blobId: 'blob-2', itemId: 'item-2' })
        ]
      },
      { pendingDownloads: [] }
    ]);
    expect(getBlobManifest).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      {
        operationId: 'op-1',
        blobId: 'blob-1',
        success: true,
        skipped: true,
        attempts: 0
      },
      {
        operationId: 'op-2',
        blobId: 'blob-2',
        success: true,
        skipped: false,
        attempts: 1
      }
    ]);
    expect(decryptBlob).toHaveBeenCalledWith({
      manifest: expect.objectContaining({
        itemId: 'item-2',
        blobId: 'blob-2',
        chunkCount: 2,
        totalPlaintextBytes: 2,
        totalCiphertextBytes: 10
      }),
      chunks: [
        expect.objectContaining({
          chunkIndex: 0,
          ciphertextBase64: 'QQ==',
          isFinal: false
        }),
        expect.objectContaining({
          chunkIndex: 1,
          ciphertextBase64: 'Qg==',
          isFinal: true
        })
      ]
    });
    expect(storeLocal).toHaveBeenCalledWith(
      'blob-2',
      new Uint8Array([9, 8, 7])
    );
  });

  it('stops immediately on non-retryable failures and preserves the queue', async () => {
    const events: VfsBlobDownloadResultEvent[] = [];
    const forbiddenError = Object.assign(new Error('forbidden'), {
      status: 403
    });
    const flusher = createFlusher({
      getBlobManifest: vi.fn(async () => {
        throw forbiddenError;
      }),
      onOperationResult: async (event) => {
        events.push(event);
      }
    });

    flusher.queueDownloads([createOperation(1), createOperation(2)]);

    await expect(flusher.flush()).resolves.toEqual({
      processedDownloads: 0,
      pendingDownloads: 2,
      skippedAlreadyCached: 0
    });
    expect(flusher.pendingCount).toBe(2);
    expect(events).toEqual([
      {
        operationId: 'op-1',
        blobId: 'blob-1',
        success: false,
        skipped: false,
        attempts: 1,
        failureClass: 'http_status',
        statusCode: 403
      }
    ]);
  });

  it('retries transient failures until the download succeeds', async () => {
    let manifestAttempts = 0;
    const events: VfsBlobDownloadResultEvent[] = [];
    const unavailableError = Object.assign(new Error('unavailable'), {
      status: 503
    });
    const flusher = createFlusher({
      getBlobManifest: vi.fn(async () => {
        manifestAttempts += 1;
        if (manifestAttempts < 3) {
          throw unavailableError;
        }
        return createManifest({ blobId: 'blob-1', chunkCount: 1 });
      }),
      getBlobChunk: vi.fn(async () => createChunk(0, [99], { isFinal: true })),
      retryPolicy: {
        maxAttempts: 3,
        initialDelayMs: 0,
        maxDelayMs: 0,
        backoffMultiplier: 2
      },
      onOperationResult: async (event) => {
        events.push(event);
      }
    });

    flusher.queueDownloads([createOperation(1)]);

    await expect(flusher.flush()).resolves.toEqual({
      processedDownloads: 1,
      pendingDownloads: 0,
      skippedAlreadyCached: 0
    });
    expect(manifestAttempts).toBe(3);
    expect(events).toEqual([
      {
        operationId: 'op-1',
        blobId: 'blob-1',
        success: true,
        skipped: false,
        attempts: 3
      }
    ]);
  });

  it('emits a terminal failure event after exhausting retryable attempts', async () => {
    const events: VfsBlobDownloadResultEvent[] = [];
    const unavailableError = Object.assign(new TypeError('network down'), {
      status: 503
    });
    const flusher = createFlusher({
      getBlobManifest: vi.fn(async () => {
        throw unavailableError;
      }),
      retryPolicy: {
        maxAttempts: 2,
        initialDelayMs: 0,
        maxDelayMs: 0,
        backoffMultiplier: 2
      },
      onOperationResult: async (event) => {
        events.push(event);
      }
    });

    flusher.queueDownloads([createOperation(1)]);

    await expect(flusher.flush()).resolves.toEqual({
      processedDownloads: 0,
      pendingDownloads: 1,
      skippedAlreadyCached: 0
    });
    expect(events).toEqual([
      {
        operationId: 'op-1',
        blobId: 'blob-1',
        success: false,
        skipped: false,
        attempts: 2,
        failureClass: 'http_status',
        statusCode: 503
      }
    ]);
  });
});
