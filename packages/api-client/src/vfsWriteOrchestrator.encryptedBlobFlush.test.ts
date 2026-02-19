import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('vfsWriteOrchestrator encrypted blob flush', () => {
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

  it('flushes staged encrypted blob pipeline operations', async () => {
    const observedRequests: Array<{ url: string; body: unknown }> = [];
    vi.mocked(global.fetch).mockImplementation(
      async (
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> => {
        const url = input.toString();
        if (typeof init?.body === 'string') {
          observedRequests.push({ url, body: JSON.parse(init.body) });
        }

        if (url.endsWith('/v1/vfs/crdt/push')) {
          return new Response(
            JSON.stringify({
              clientId: 'desktop',
              results: []
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
        if (url.includes('/v1/vfs/crdt/vfs-sync')) {
          return new Response(
            JSON.stringify({
              items: [],
              hasMore: false,
              nextCursor: null,
              lastReconciledWriteIds: {}
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
        if (url.endsWith('/v1/vfs/crdt/reconcile')) {
          return new Response(
            JSON.stringify({
              clientId: 'desktop',
              cursor: '2026-02-18T00:00:00.000Z|desktop-1',
              lastReconciledWriteIds: { desktop: 1 }
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    );

    const { VfsWriteOrchestrator } = await import('./vfsWriteOrchestrator');
    const orchestrator = new VfsWriteOrchestrator('user-1', 'desktop', {
      crdt: {
        transportOptions: {
          baseUrl: 'http://localhost',
          apiPrefix: '/v1'
        }
      },
      blob: {
        baseUrl: 'http://localhost',
        apiPrefix: '/v1'
      }
    });

    orchestrator.queueBlobStage({
      stagingId: 'stage-enc-1',
      blobId: 'blob-enc-1',
      expiresAt: '2026-02-18T01:00:00.000Z',
      encryption: {
        algorithm: 'vfs-envelope-v1',
        keyEpoch: 2,
        manifestHash: 'manifest-hash-1',
        chunkCount: 2,
        chunkSizeBytes: 512,
        plaintextSizeBytes: 1024,
        ciphertextSizeBytes: 1152,
        checkpoint: {
          uploadId: 'upload-1',
          nextChunkIndex: 0
        }
      }
    });
    orchestrator.queueBlobChunk({
      stagingId: 'stage-enc-1',
      uploadId: 'upload-1',
      chunkIndex: 0,
      isFinal: false,
      nonce: 'nonce-1',
      aadHash: 'aad-hash-1',
      ciphertextBase64: 'Y2lwaGVydGV4dC0x',
      plaintextLength: 512,
      ciphertextLength: 576
    });
    orchestrator.queueBlobChunk({
      stagingId: 'stage-enc-1',
      uploadId: 'upload-1',
      chunkIndex: 1,
      isFinal: true,
      nonce: 'nonce-2',
      aadHash: 'aad-hash-2',
      ciphertextBase64: 'Y2lwaGVydGV4dC0y',
      plaintextLength: 512,
      ciphertextLength: 576
    });
    orchestrator.queueBlobManifestCommit({
      stagingId: 'stage-enc-1',
      uploadId: 'upload-1',
      keyEpoch: 2,
      manifestHash: 'manifest-hash-1',
      manifestSignature: 'manifest-signature-1',
      chunkCount: 2,
      totalPlaintextBytes: 1024,
      totalCiphertextBytes: 1152
    });
    orchestrator.queueBlobAttach({
      stagingId: 'stage-enc-1',
      itemId: 'item-1',
      relationKind: 'file'
    });

    await expect(orchestrator.flushAll()).resolves.toEqual({
      crdt: {
        pushedOperations: 0,
        pulledOperations: 0,
        pullPages: 1
      },
      blob: {
        processedOperations: 5,
        pendingOperations: 0
      }
    });

    expect(
      observedRequests.find((request) =>
        request.url.endsWith('/v1/vfs/blobs/stage')
      )?.body
    ).toEqual(
      expect.objectContaining({
        stagingId: 'stage-enc-1',
        blobId: 'blob-enc-1',
        encryption: expect.objectContaining({
          algorithm: 'vfs-envelope-v1',
          keyEpoch: 2
        })
      })
    );
    expect(
      observedRequests.find((request) =>
        request.url.endsWith('/v1/vfs/blobs/stage/stage-enc-1/chunks')
      )?.body
    ).toEqual(
      expect.objectContaining({
        uploadId: 'upload-1',
        chunkIndex: 0
      })
    );
    expect(
      observedRequests.find((request) =>
        request.url.endsWith('/v1/vfs/blobs/stage/stage-enc-1/commit')
      )?.body
    ).toEqual(
      expect.objectContaining({
        uploadId: 'upload-1',
        keyEpoch: 2,
        chunkCount: 2
      })
    );
    expect(
      observedRequests.find((request) =>
        request.url.endsWith('/v1/vfs/blobs/stage/stage-enc-1/attach')
      )?.body
    ).toEqual(
      expect.objectContaining({
        itemId: 'item-1',
        relationKind: 'file'
      })
    );
  });
});
