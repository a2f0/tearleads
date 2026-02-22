import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VfsBlobNetworkFlusherPersistedState } from './vfsBlobNetworkFlusher';

interface ObservedRequest {
  url: string;
  body: unknown;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function summarizePendingKinds(
  state: VfsBlobNetworkFlusherPersistedState
): string[] {
  return state.pendingOperations.map((operation) => {
    if (operation.kind !== 'chunk') {
      return operation.kind;
    }
    return `chunk:${operation.payload.chunkIndex}`;
  });
}

describe('vfsBlobNetworkFlusher retry invariants', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    global.fetch = vi.fn();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = originalFetch;
  });

  it('resumes from failed chunk while preserving operation order', async () => {
    const persistedSnapshots: VfsBlobNetworkFlusherPersistedState[] = [];
    const saveState = vi.fn(async (state: VfsBlobNetworkFlusherPersistedState) => {
      persistedSnapshots.push(
        JSON.parse(JSON.stringify(state)) as VfsBlobNetworkFlusherPersistedState
      );
    });

    let failedChunk2 = false;
    const observedRequests: ObservedRequest[] = [];
    vi.mocked(global.fetch).mockImplementation(
      async (
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> => {
        const url = input.toString();
        const body =
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : {};
        observedRequests.push({ url, body });

        if (url.endsWith('/v1/vfs/blobs/stage/stage-1/chunks')) {
          const chunkIndex = body['chunkIndex'];
          if (chunkIndex === 2 && !failedChunk2) {
            failedChunk2 = true;
            return jsonResponse({ error: 'Service unavailable' }, 503);
          }
        }

        return jsonResponse({ ok: true });
      }
    );

    const { VfsBlobNetworkFlusher } = await import('./vfsBlobNetworkFlusher');
    const flusher = new VfsBlobNetworkFlusher({
      baseUrl: 'http://localhost',
      apiPrefix: '/v1',
      saveState,
      retryPolicy: { maxAttempts: 1 }
    });

    flusher.queueStage({
      stagingId: 'stage-1',
      blobId: 'blob-1',
      expiresAt: '2026-02-18T01:00:00.000Z'
    });
    for (let index = 0; index < 4; index += 1) {
      flusher.queueChunk({
        stagingId: 'stage-1',
        uploadId: 'upload-1',
        chunkIndex: index,
        isFinal: index === 3,
        nonce: `nonce-${index}`,
        aadHash: `aad-${index}`,
        ciphertextBase64: `cipher-${index}`,
        plaintextLength: 1024,
        ciphertextLength: 1088
      });
    }
    flusher.queueManifestCommit({
      stagingId: 'stage-1',
      uploadId: 'upload-1',
      keyEpoch: 1,
      manifestHash: 'manifest-hash-1',
      manifestSignature: 'manifest-signature-1',
      chunkCount: 4,
      totalPlaintextBytes: 4096,
      totalCiphertextBytes: 4352
    });
    flusher.queueAttach({
      stagingId: 'stage-1',
      itemId: 'item-1',
      relationKind: 'file'
    });

    await expect(flusher.flush()).rejects.toThrow('Service unavailable');

    const lastPersisted = persistedSnapshots[persistedSnapshots.length - 1];
    if (!lastPersisted) {
      throw new Error('Expected persisted state snapshot after failure');
    }
    expect(summarizePendingKinds(lastPersisted)).toEqual([
      'chunk:2',
      'chunk:3',
      'commit',
      'attach'
    ]);

    const resumed = new VfsBlobNetworkFlusher({
      baseUrl: 'http://localhost',
      apiPrefix: '/v1'
    });
    resumed.hydrateState(lastPersisted);

    await expect(resumed.flush()).resolves.toEqual({
      processedOperations: 4,
      pendingOperations: 0
    });

    const chunkCalls = observedRequests.filter((request) =>
      request.url.endsWith('/v1/vfs/blobs/stage/stage-1/chunks')
    );
    const chunkIndices = chunkCalls
      .map((request) => (request.body as { chunkIndex?: unknown }).chunkIndex)
      .filter((value): value is number => Number.isInteger(value));
    expect(chunkIndices).toEqual([0, 1, 2, 2, 3]);

    const commitCalls = observedRequests.filter((request) =>
      request.url.endsWith('/v1/vfs/blobs/stage/stage-1/commit')
    );
    expect(commitCalls).toHaveLength(1);

    const attachCalls = observedRequests.filter((request) =>
      request.url.endsWith('/v1/vfs/blobs/stage/stage-1/attach')
    );
    expect(attachCalls).toHaveLength(1);
  });

  it('retries manifest commit without replaying successful chunks', async () => {
    let failCommitOnce = true;
    const observedRequests: ObservedRequest[] = [];

    vi.mocked(global.fetch).mockImplementation(
      async (
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> => {
        const url = input.toString();
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
        observedRequests.push({ url, body });

        if (
          url.endsWith('/v1/vfs/blobs/stage/stage-2/commit') &&
          failCommitOnce
        ) {
          failCommitOnce = false;
          return jsonResponse({ error: 'Manifest commit unavailable' }, 503);
        }

        return jsonResponse({ ok: true });
      }
    );

    const { VfsBlobNetworkFlusher } = await import('./vfsBlobNetworkFlusher');
    const flusher = new VfsBlobNetworkFlusher({
      baseUrl: 'http://localhost',
      apiPrefix: '/v1',
      retryPolicy: { maxAttempts: 1 }
    });
    flusher.queueStage({
      stagingId: 'stage-2',
      blobId: 'blob-2',
      expiresAt: '2026-02-18T01:00:00.000Z'
    });
    flusher.queueChunk({
      stagingId: 'stage-2',
      uploadId: 'upload-2',
      chunkIndex: 0,
      isFinal: true,
      nonce: 'nonce-0',
      aadHash: 'aad-0',
      ciphertextBase64: 'cipher-0',
      plaintextLength: 512,
      ciphertextLength: 576
    });
    flusher.queueManifestCommit({
      stagingId: 'stage-2',
      uploadId: 'upload-2',
      keyEpoch: 2,
      manifestHash: 'manifest-hash-2',
      manifestSignature: 'manifest-signature-2',
      chunkCount: 1,
      totalPlaintextBytes: 512,
      totalCiphertextBytes: 576
    });
    flusher.queueAttach({
      stagingId: 'stage-2',
      itemId: 'item-2',
      relationKind: 'file'
    });

    await expect(flusher.flush()).rejects.toThrow(
      'Manifest commit unavailable'
    );
    expect(flusher.queuedOperations().map((operation) => operation.kind)).toEqual(
      ['commit', 'attach']
    );

    await expect(flusher.flush()).resolves.toEqual({
      processedOperations: 2,
      pendingOperations: 0
    });

    const stageCalls = observedRequests.filter((request) =>
      request.url.endsWith('/v1/vfs/blobs/stage')
    );
    const chunkCalls = observedRequests.filter((request) =>
      request.url.endsWith('/v1/vfs/blobs/stage/stage-2/chunks')
    );
    const commitCalls = observedRequests.filter((request) =>
      request.url.endsWith('/v1/vfs/blobs/stage/stage-2/commit')
    );
    const attachCalls = observedRequests.filter((request) =>
      request.url.endsWith('/v1/vfs/blobs/stage/stage-2/attach')
    );

    expect(stageCalls).toHaveLength(1);
    expect(chunkCalls).toHaveLength(1);
    expect(commitCalls).toHaveLength(2);
    expect(attachCalls).toHaveLength(1);
  });

  it('automatically retries transient status failures with backoff', async () => {
    let stageAttempts = 0;
    const retrySleep = vi.fn(async () => undefined);
    const onRetry = vi.fn(async () => undefined);
    const onOperationResult = vi.fn(async () => undefined);
    vi.mocked(global.fetch).mockImplementation(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = input.toString();
        if (url.endsWith('/v1/vfs/blobs/stage')) {
          stageAttempts += 1;
          if (stageAttempts < 3) {
            return jsonResponse({ error: 'Service unavailable' }, 503);
          }
        }
        return jsonResponse({ ok: true });
      }
    );

    const { VfsBlobNetworkFlusher } = await import('./vfsBlobNetworkFlusher');
    const flusher = new VfsBlobNetworkFlusher({
      baseUrl: 'http://localhost',
      apiPrefix: '/v1',
      retrySleep,
      onRetry,
      onOperationResult,
      retryPolicy: {
        maxAttempts: 3,
        initialDelayMs: 10,
        maxDelayMs: 20,
        backoffMultiplier: 2
      }
    });
    flusher.queueStage({
      stagingId: 'stage-retry-1',
      blobId: 'blob-retry-1',
      expiresAt: '2026-02-18T01:00:00.000Z'
    });

    await expect(flusher.flush()).resolves.toEqual({
      processedOperations: 1,
      pendingOperations: 0
    });

    expect(stageAttempts).toBe(3);
    expect(retrySleep).toHaveBeenCalledTimes(2);
    expect(retrySleep).toHaveBeenNthCalledWith(1, 10);
    expect(retrySleep).toHaveBeenNthCalledWith(2, 20);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        operationKind: 'stage',
        attempt: 1,
        failureClass: 'http_status',
        statusCode: 503
      })
    );
    expect(onOperationResult).toHaveBeenCalledWith(
      expect.objectContaining({
        operationKind: 'stage',
        attempts: 3,
        retryCount: 2,
        success: true
      })
    );
  });

  it('automatically retries network errors and does not retry conflict errors', async () => {
    const retrySleep = vi.fn(async () => undefined);

    let networkAttempts = 0;
    vi.mocked(global.fetch).mockImplementation(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = input.toString();
        if (url.endsWith('/v1/vfs/blobs/stage')) {
          networkAttempts += 1;
          if (networkAttempts === 1) {
            throw new TypeError('network down');
          }
        }

        if (url.endsWith('/v1/vfs/blobs/stage/stage-no-retry/attach')) {
          return jsonResponse({ error: 'Already attached' }, 409);
        }
        return jsonResponse({ ok: true });
      }
    );

    const { VfsBlobNetworkFlusher } = await import('./vfsBlobNetworkFlusher');
    const flusher = new VfsBlobNetworkFlusher({
      baseUrl: 'http://localhost',
      apiPrefix: '/v1',
      retrySleep,
      retryPolicy: {
        maxAttempts: 3,
        initialDelayMs: 5,
        maxDelayMs: 20,
        backoffMultiplier: 2
      }
    });
    flusher.queueStage({
      stagingId: 'stage-network-retry',
      blobId: 'blob-network-retry',
      expiresAt: '2026-02-18T01:00:00.000Z'
    });
    flusher.queueAttach({
      stagingId: 'stage-no-retry',
      itemId: 'item-409',
      relationKind: 'file'
    });

    await expect(flusher.flush()).rejects.toThrow('Already attached');

    // Stage retried once on TypeError, attach 409 was not retried.
    expect(networkAttempts).toBe(2);
    expect(retrySleep).toHaveBeenCalledTimes(1);
    expect(flusher.queuedOperations().map((operation) => operation.kind)).toEqual(
      ['attach']
    );
  });
});
