import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVfsSecureOrchestratorFacade } from './secureOrchestratorFacade';

describe('secureOrchestratorFacade integration', () => {
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

  it('queues and flushes stage/chunks/commit/attach through write orchestrator', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    vi.mocked(global.fetch).mockImplementation(
      async (
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> => {
        const url = input.toString();
        if (typeof init?.body === 'string') {
          requests.push({ url, body: JSON.parse(init.body) });
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

    const { VfsWriteOrchestrator } = await import('../vfsWriteOrchestrator');
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

    const facade = createVfsSecureOrchestratorFacade(
      orchestrator,
      {
        uploadEncryptedBlob: vi.fn(async () => ({
          manifest: {
            itemId: 'item-1',
            blobId: 'blob-1',
            keyEpoch: 7,
            totalPlaintextBytes: 1024,
            totalCiphertextBytes: 1152,
            chunkCount: 2,
            chunkHashes: ['hash-1', 'hash-2'],
            wrappedFileKeys: [],
            manifestSignature: 'manifest-signature-7'
          },
          uploadId: 'upload-7',
          chunks: [
            {
              chunkIndex: 0,
              isFinal: false,
              nonce: 'nonce-1',
              aadHash: 'aad-hash-1',
              ciphertextBase64: 'Y2lwaGVydGV4dC0x',
              plaintextLength: 512,
              ciphertextLength: 576
            },
            {
              chunkIndex: 1,
              isFinal: true,
              nonce: 'nonce-2',
              aadHash: 'aad-hash-2',
              ciphertextBase64: 'Y2lwaGVydGV4dC0y',
              plaintextLength: 512,
              ciphertextLength: 576
            }
          ]
        })),
        encryptCrdtOp: vi.fn()
      },
      { relationKind: 'file' }
    );

    const result = await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'item-1',
      blobId: 'blob-1',
      stream: new ReadableStream<Uint8Array>(),
      expiresAt: '2026-02-19T12:00:00.000Z'
    });

    expect(result).toEqual(
      expect.objectContaining({
        stagingId: expect.any(String),
        manifest: expect.objectContaining({
          keyEpoch: 7,
          chunkCount: 2
        })
      })
    );
    expect(orchestrator.queuedBlobOperations()).toHaveLength(5);

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
      requests.some((request) => request.url.endsWith('/v1/vfs/blobs/stage'))
    ).toBe(true);
    expect(
      requests.some(
        (request) =>
          request.url.includes('/v1/vfs/blobs/stage/') &&
          request.url.endsWith('/chunks')
      )
    ).toBe(true);
    expect(
      requests.some(
        (request) =>
          request.url.includes('/v1/vfs/blobs/stage/') &&
          request.url.endsWith('/commit')
      )
    ).toBe(true);
    expect(
      requests.some(
        (request) =>
          request.url.includes('/v1/vfs/blobs/stage/') &&
          request.url.endsWith('/attach')
      )
    ).toBe(true);
  });
});
