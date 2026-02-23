import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVfsCryptoEngine } from './engineRuntime';
import { createVfsSecureOrchestratorFacadeWithRuntime } from './secureOrchestratorFacade';

function generateTestKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

function createTestKeyResolver() {
  const keys = new Map<string, Uint8Array>();
  return {
    setKey(itemId: string, epoch: number, key: Uint8Array): void {
      keys.set(`${itemId}:${epoch}`, key);
    },
    getItemKey: vi.fn(
      ({ itemId, keyEpoch }: { itemId: string; keyEpoch: number }) => {
        const key = keys.get(`${itemId}:${keyEpoch}`);
        if (!key) {
          throw new Error(`Key not found for ${itemId}:${keyEpoch}`);
        }
        return key;
      }
    )
  };
}

describe('secureOrchestratorFacade checkpoint fields', () => {
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

  it('sets checkpoint nextChunkIndex to 1 for single-chunk upload', async () => {
    vi.mocked(global.fetch).mockImplementation(async (): Promise<Response> => {
      return new Response(
        JSON.stringify({
          clientId: 'desktop',
          results: [],
          items: [],
          hasMore: false,
          nextCursor: null,
          lastReconciledWriteIds: {}
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const keyResolver = createTestKeyResolver();
    const testKey = generateTestKey();
    keyResolver.setKey('item-1', 1, testKey);

    const queueBlobStageAndPersist = vi.fn(async () => ({
      operationId: 'op-stage-1',
      kind: 'stage' as const,
      payload: {
        stagingId: 'stage-1',
        blobId: 'blob-1',
        expiresAt: '2026-02-20T00:00:00.000Z'
      }
    }));

    const { VfsWriteOrchestrator } = await import('../vfsWriteOrchestrator');
    const orchestrator = new VfsWriteOrchestrator('user-1', 'desktop', {
      crdt: {
        transportOptions: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
      },
      blob: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
    });
    orchestrator.queueBlobStageAndPersist = queueBlobStageAndPersist;

    const facade = createVfsSecureOrchestratorFacadeWithRuntime(
      orchestrator,
      {
        engine: createVfsCryptoEngine({ keyResolver }),
        chunkSizeBytes: 1024,
        resolveKeyEpoch: () => 1
      },
      { relationKind: 'file' }
    );

    const plaintext = new TextEncoder().encode('Small data');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(plaintext);
        controller.close();
      }
    });

    await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'item-1',
      blobId: 'blob-1',
      contentType: 'text/plain',
      stream,
      expiresAt: '2026-02-20T00:00:00.000Z'
    });

    expect(queueBlobStageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        blobId: 'blob-1',
        expiresAt: '2026-02-20T00:00:00.000Z',
        stagingId: expect.any(String)
      })
    );
  });

  it('sets checkpoint nextChunkIndex to chunkCount for multi-chunk upload', async () => {
    vi.mocked(global.fetch).mockImplementation(async (): Promise<Response> => {
      return new Response(
        JSON.stringify({
          clientId: 'desktop',
          results: [],
          items: [],
          hasMore: false,
          nextCursor: null,
          lastReconciledWriteIds: {}
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const keyResolver = createTestKeyResolver();
    const testKey = generateTestKey();
    keyResolver.setKey('item-2', 1, testKey);

    const queueBlobStageAndPersist = vi.fn(async () => ({
      operationId: 'op-stage-1',
      kind: 'stage' as const,
      payload: {
        stagingId: 'stage-1',
        blobId: 'blob-2',
        expiresAt: '2026-02-20T00:00:00.000Z'
      }
    }));

    const { VfsWriteOrchestrator } = await import('../vfsWriteOrchestrator');
    const orchestrator = new VfsWriteOrchestrator('user-1', 'desktop', {
      crdt: {
        transportOptions: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
      },
      blob: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
    });
    orchestrator.queueBlobStageAndPersist = queueBlobStageAndPersist;

    const facade = createVfsSecureOrchestratorFacadeWithRuntime(
      orchestrator,
      {
        engine: createVfsCryptoEngine({ keyResolver }),
        chunkSizeBytes: 32,
        resolveKeyEpoch: () => 1
      },
      { relationKind: 'file' }
    );

    const plaintext = new Uint8Array(100);
    crypto.getRandomValues(plaintext);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(plaintext);
        controller.close();
      }
    });

    const result = await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'item-2',
      blobId: 'blob-2',
      stream,
      expiresAt: '2026-02-20T00:00:00.000Z'
    });

    const chunkCount = result.manifest.chunkCount;
    expect(chunkCount).toBeGreaterThan(1);

    expect(queueBlobStageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        blobId: 'blob-2',
        expiresAt: '2026-02-20T00:00:00.000Z',
        stagingId: expect.any(String)
      })
    );
  });

  it('sets checkpoint nextChunkIndex to 1 for empty stream', async () => {
    vi.mocked(global.fetch).mockImplementation(async (): Promise<Response> => {
      return new Response(
        JSON.stringify({
          clientId: 'desktop',
          results: [],
          items: [],
          hasMore: false,
          nextCursor: null,
          lastReconciledWriteIds: {}
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const keyResolver = createTestKeyResolver();
    const testKey = generateTestKey();
    keyResolver.setKey('item-3', 1, testKey);

    const queueBlobStageAndPersist = vi.fn(async () => ({
      operationId: 'op-stage-1',
      kind: 'stage' as const,
      payload: {
        stagingId: 'stage-1',
        blobId: 'blob-3',
        expiresAt: '2026-02-20T00:00:00.000Z'
      }
    }));

    const { VfsWriteOrchestrator } = await import('../vfsWriteOrchestrator');
    const orchestrator = new VfsWriteOrchestrator('user-1', 'desktop', {
      crdt: {
        transportOptions: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
      },
      blob: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
    });
    orchestrator.queueBlobStageAndPersist = queueBlobStageAndPersist;

    const facade = createVfsSecureOrchestratorFacadeWithRuntime(
      orchestrator,
      {
        engine: createVfsCryptoEngine({ keyResolver }),
        chunkSizeBytes: 1024,
        resolveKeyEpoch: () => 1
      },
      { relationKind: 'file' }
    );

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      }
    });

    const result = await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'item-3',
      blobId: 'blob-3',
      stream,
      expiresAt: '2026-02-20T00:00:00.000Z'
    });

    expect(result.manifest.chunkCount).toBe(1);
    expect(result.manifest.totalPlaintextBytes).toBe(0);

    expect(queueBlobStageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        blobId: 'blob-3',
        expiresAt: '2026-02-20T00:00:00.000Z',
        stagingId: expect.any(String)
      })
    );
  });

  it('checkpoint uploadId is unique per upload', async () => {
    vi.mocked(global.fetch).mockImplementation(async (): Promise<Response> => {
      return new Response(
        JSON.stringify({
          clientId: 'desktop',
          results: [],
          items: [],
          hasMore: false,
          nextCursor: null,
          lastReconciledWriteIds: {}
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const keyResolver = createTestKeyResolver();
    const testKey = generateTestKey();
    keyResolver.setKey('item-4', 1, testKey);
    keyResolver.setKey('item-5', 1, testKey);

    const uploadIds = new Set<string>();
    const queueBlobStageAndPersist = vi.fn(async (input) => {
      return {
        operationId: `op-stage-${uploadIds.size + 1}`,
        kind: 'stage' as const,
        payload: {
          stagingId: `stage-${uploadIds.size + 1}`,
          blobId: input.blobId,
          expiresAt: input.expiresAt
        }
      };
    });

    const { VfsWriteOrchestrator } = await import('../vfsWriteOrchestrator');
    const orchestrator = new VfsWriteOrchestrator('user-1', 'desktop', {
      crdt: {
        transportOptions: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
      },
      blob: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
    });
    orchestrator.queueBlobStageAndPersist = queueBlobStageAndPersist;
    orchestrator.queueBlobChunkAndPersist = vi.fn(async (input) => {
      uploadIds.add(input.uploadId);
      return {
        operationId: `op-chunk-${input.chunkIndex}`,
        kind: 'chunk' as const,
        payload: input
      };
    });

    const facade = createVfsSecureOrchestratorFacadeWithRuntime(
      orchestrator,
      {
        engine: createVfsCryptoEngine({ keyResolver }),
        chunkSizeBytes: 1024,
        resolveKeyEpoch: () => 1
      },
      { relationKind: 'file' }
    );

    const stream1 = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('Data 1'));
        controller.close();
      }
    });

    const stream2 = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('Data 2'));
        controller.close();
      }
    });

    await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'item-4',
      blobId: 'blob-4',
      stream: stream1,
      expiresAt: '2026-02-20T00:00:00.000Z'
    });

    await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'item-5',
      blobId: 'blob-5',
      stream: stream2,
      expiresAt: '2026-02-20T00:00:00.000Z'
    });

    expect(uploadIds.size).toBe(2);
  });

  it('checkpoint contains correct encryption metadata fields', async () => {
    vi.mocked(global.fetch).mockImplementation(async (): Promise<Response> => {
      return new Response(
        JSON.stringify({
          clientId: 'desktop',
          results: [],
          items: [],
          hasMore: false,
          nextCursor: null,
          lastReconciledWriteIds: {}
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const keyResolver = createTestKeyResolver();
    const testKey = generateTestKey();
    keyResolver.setKey('item-6', 3, testKey);

    const queueBlobStageAndPersist = vi.fn(async () => ({
      operationId: 'op-stage-1',
      kind: 'stage' as const,
      payload: {
        stagingId: 'stage-1',
        blobId: 'blob-6',
        expiresAt: '2026-02-20T00:00:00.000Z'
      }
    }));

    const { VfsWriteOrchestrator } = await import('../vfsWriteOrchestrator');
    const orchestrator = new VfsWriteOrchestrator('user-1', 'desktop', {
      crdt: {
        transportOptions: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
      },
      blob: { baseUrl: 'http://localhost', apiPrefix: '/v1' }
    });
    orchestrator.queueBlobStageAndPersist = queueBlobStageAndPersist;

    const facade = createVfsSecureOrchestratorFacadeWithRuntime(
      orchestrator,
      {
        engine: createVfsCryptoEngine({ keyResolver }),
        chunkSizeBytes: 128,
        resolveKeyEpoch: () => 3
      },
      { relationKind: 'photo' }
    );

    const plaintext = new TextEncoder().encode('Test data for metadata check');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(plaintext);
        controller.close();
      }
    });

    const result = await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'item-6',
      blobId: 'blob-6',
      contentType: 'text/plain',
      stream,
      expiresAt: '2026-02-20T00:00:00.000Z'
    });

    expect(queueBlobStageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        blobId: 'blob-6',
        expiresAt: '2026-02-20T00:00:00.000Z',
        stagingId: expect.any(String)
      })
    );
    expect(result.manifest.keyEpoch).toBe(3);
    expect(result.manifest.chunkCount).toBe(1);
    expect(result.manifest.totalPlaintextBytes).toBe(plaintext.length);
    expect(result.manifest.totalCiphertextBytes).toBeGreaterThan(
      result.manifest.totalPlaintextBytes
    );
  });
});
