import { encodeVfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('vfsWriteOrchestrator encrypted blob flush', () => {
  const originalFetch = global.fetch;

  const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  };

  const connectJsonEnvelope = (payload: unknown): string => {
    return JSON.stringify({ json: JSON.stringify(payload) });
  };

  const parseJsonEnvelope = (body: unknown): Record<string, unknown> => {
    if (!isRecord(body) || typeof body['json'] !== 'string') {
      return {};
    }

    const parsed = JSON.parse(body['json']);
    return isRecord(parsed) ? parsed : {};
  };

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

        if (url.endsWith('/connect/tearleads.v1.VfsService/PushCrdtOps')) {
          return new Response(
            connectJsonEnvelope({
              clientId: 'desktop',
              results: []
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
        if (url.includes('/connect/tearleads.v1.VfsService/GetCrdtSync')) {
          return new Response(
            connectJsonEnvelope({
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
        if (url.endsWith('/connect/tearleads.v1.VfsService/ReconcileCrdt')) {
          return new Response(
            connectJsonEnvelope({
              clientId: 'desktop',
              cursor: encodeVfsSyncCursor({
                changedAt: '2026-02-18T00:00:00.000Z',
                changeId: 'desktop-1'
              }),
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
          apiPrefix: ''
        }
      },
      blob: {
        baseUrl: 'http://localhost'
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
      parseJsonEnvelope(
        observedRequests.find((request) =>
          request.url.endsWith('/connect/tearleads.v1.VfsService/StageBlob')
        )?.body
      )
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
      parseJsonEnvelope(
        observedRequests.find((request) => {
          if (
            !request.url.endsWith(
              '/connect/tearleads.v1.VfsService/UploadBlobChunk'
            )
          ) {
            return false;
          }
          return parseJsonEnvelope(request.body).chunkIndex === 0;
        })?.body
      )
    ).toEqual(
      expect.objectContaining({
        uploadId: 'upload-1',
        chunkIndex: 0
      })
    );
    expect(
      parseJsonEnvelope(
        observedRequests.find((request) =>
          request.url.endsWith('/connect/tearleads.v1.VfsService/CommitBlob')
        )?.body
      )
    ).toEqual(
      expect.objectContaining({
        uploadId: 'upload-1',
        keyEpoch: 2,
        chunkCount: 2
      })
    );
    expect(
      parseJsonEnvelope(
        observedRequests.find((request) =>
          request.url.endsWith('/connect/tearleads.v1.VfsService/AttachBlob')
        )?.body
      )
    ).toEqual(
      expect.objectContaining({
        itemId: 'item-1',
        relationKind: 'file'
      })
    );
  });
});
