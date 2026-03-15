import { VFS_V2_CONNECT_BASE_PATH } from '@tearleads/shared';
import { encodeVfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTestEnv } from '../test/env.js';
import { createVfsSecureOrchestratorFacade } from './secureOrchestratorFacade';
import { recordSecureFacadeRequestBody } from './secureOrchestratorFacade.testSupport';

const RECONCILE_CURSOR_CHANGE_ID = '00000000-0000-0000-0000-000000000001';

function encodeTextToBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}
const ENCODED_CLIENT_ID = btoa('desktop');
const ENCODED_DESKTOP_OP_ID = btoa('desktop-1');
const ENCODED_CIPHERTEXT_OP_ID = btoa('ciphertext-op-1');
const ENCODED_PARENT_ID = btoa('enc-parent:9');
const ENCODED_ITEM_ID = btoa('item-11');
const LINK_ADD_OP_TYPE = 'VFS_CRDT_OP_TYPE_LINK_ADD';

function connectJsonEnvelope(payload: unknown): string {
  return JSON.stringify({ json: JSON.stringify(payload) });
}

describe('secureOrchestratorFacade integration', () => {
  const originalFetch = global.fetch;
  let fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setTestEnv('VITE_API_URL', 'http://localhost');
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('queues and flushes stage/chunks/commit/attach through write orchestrator', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    fetchMock.mockImplementation(
      async (
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> => {
        const url = input.toString();
        await recordSecureFacadeRequestBody(requests, url, input, init);

        if (url.endsWith(`${VFS_V2_CONNECT_BASE_PATH}/PushCrdtOps`)) {
          return new Response(
            connectJsonEnvelope({
              clientId: encodeTextToBase64('desktop'),
              results: []
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
        if (url.includes(`${VFS_V2_CONNECT_BASE_PATH}/GetCrdtSync`)) {
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
        if (url.endsWith(`${VFS_V2_CONNECT_BASE_PATH}/ReconcileCrdt`)) {
          return new Response(
            connectJsonEnvelope({
              clientId: encodeTextToBase64('desktop'),
              cursor: encodeVfsSyncCursor({
                changedAt: '2026-02-18T00:00:00.000Z',
                changeId: RECONCILE_CURSOR_CHANGE_ID
              }),
              lastReconciledWriteIds: { desktop: '1' }
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
          apiPrefix: ''
        }
      },
      blob: {
        baseUrl: 'http://localhost'
      }
    });

    const facade = createVfsSecureOrchestratorFacade(
      orchestrator,
      {
        uploadEncryptedBlob: vi.fn(async (input) => {
          // Simulate streaming chunks via callback
          await input.onChunk?.({
            chunkIndex: 0,
            isFinal: false,
            nonce: 'nonce-1',
            aadHash: 'aad-hash-1',
            ciphertextBase64: 'Y2lwaGVydGV4dC0x',
            plaintextLength: 512,
            ciphertextLength: 576
          });
          await input.onChunk?.({
            chunkIndex: 1,
            isFinal: true,
            nonce: 'nonce-2',
            aadHash: 'aad-hash-2',
            ciphertextBase64: 'Y2lwaGVydGV4dC0y',
            plaintextLength: 512,
            ciphertextLength: 576
          });

          return {
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
            uploadId: 'upload-7'
          };
        }),
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
      requests.some((request) =>
        request.url.endsWith(`${VFS_V2_CONNECT_BASE_PATH}/StageBlob`)
      )
    ).toBe(true);
    expect(
      requests.some((request) =>
        request.url.endsWith(`${VFS_V2_CONNECT_BASE_PATH}/UploadBlobChunk`)
      )
    ).toBe(true);
    expect(
      requests.some((request) =>
        request.url.endsWith(`${VFS_V2_CONNECT_BASE_PATH}/CommitBlob`)
      )
    ).toBe(true);
    expect(
      requests.some((request) =>
        request.url.endsWith(`${VFS_V2_CONNECT_BASE_PATH}/AttachBlob`)
      )
    ).toBe(true);
  });

  it('maps encrypted CRDT ops and flushes them through CRDT push', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    fetchMock.mockImplementation(
      async (
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> => {
        const url = input.toString();
        await recordSecureFacadeRequestBody(requests, url, input, init);

        if (url.endsWith(`${VFS_V2_CONNECT_BASE_PATH}/PushCrdtOps`)) {
          return new Response(
            connectJsonEnvelope({
              clientId: encodeTextToBase64('desktop'),
              results: [
                {
                  opId: encodeTextToBase64('desktop-1'),
                  status: 'VFS_CRDT_PUSH_STATUS_APPLIED'
                }
              ]
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
        if (url.includes(`${VFS_V2_CONNECT_BASE_PATH}/GetCrdtSync`)) {
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
        if (url.endsWith(`${VFS_V2_CONNECT_BASE_PATH}/ReconcileCrdt`)) {
          return new Response(
            connectJsonEnvelope({
              clientId: encodeTextToBase64('desktop'),
              cursor: encodeVfsSyncCursor({
                changedAt: '2026-02-19T00:00:00.000Z',
                changeId: RECONCILE_CURSOR_CHANGE_ID
              }),
              lastReconciledWriteIds: { desktop: '1' }
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
          apiPrefix: ''
        }
      },
      blob: {
        baseUrl: 'http://localhost'
      }
    });

    const facade = createVfsSecureOrchestratorFacade(
      orchestrator,
      {
        uploadEncryptedBlob: vi.fn(),
        encryptCrdtOp: vi.fn(async () => ({
          encryptedOp: 'ciphertext-op-1',
          opNonce: 'nonce-1',
          opAad: 'aad-1',
          keyEpoch: 9,
          opSignature: 'sig-1'
        }))
      },
      {
        mapEncryptedCrdtOpToLocalOperation: ({ encrypted }) => ({
          opType: 'link_add',
          itemId: encrypted.encryptedOp,
          parentId: `enc-parent:${encrypted.keyEpoch}`,
          childId: encrypted.encryptedOp
        })
      }
    );

    await facade.queueEncryptedCrdtOpAndPersist({
      itemId: 'item-9',
      opType: 'link_add',
      opPayload: { payload: 'plaintext-op' }
    });

    expect(orchestrator.queuedCrdtOperations()).toHaveLength(1);

    await expect(orchestrator.flushAll()).resolves.toEqual({
      crdt: {
        pushedOperations: 1,
        pulledOperations: 0,
        pullPages: 1
      },
      blob: {
        processedOperations: 0,
        pendingOperations: 0
      }
    });

    const pushRequest = requests.find((request) => {
      return request.url.endsWith(`${VFS_V2_CONNECT_BASE_PATH}/PushCrdtOps`);
    });
    expect(pushRequest).toBeDefined();

    expect(pushRequest?.body).toEqual(
      expect.objectContaining({
        clientId: ENCODED_CLIENT_ID,
        operations: [
          expect.objectContaining({
            opId: ENCODED_DESKTOP_OP_ID,
            opType: LINK_ADD_OP_TYPE,
            itemId: ENCODED_CIPHERTEXT_OP_ID,
            parentId: ENCODED_PARENT_ID,
            childId: ENCODED_CIPHERTEXT_OP_ID,
            replicaId: ENCODED_CLIENT_ID,
            writeId: '1',
            occurredAtMs: expect.any(String)
          })
        ]
      })
    );
  });

  it('flushes encrypted CRDT ops with default mapper including encryption metadata', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    fetchMock.mockImplementation(
      async (
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> => {
        const url = input.toString();
        await recordSecureFacadeRequestBody(requests, url, input, init);

        if (url.endsWith(`${VFS_V2_CONNECT_BASE_PATH}/PushCrdtOps`)) {
          return new Response(
            connectJsonEnvelope({
              clientId: encodeTextToBase64('desktop'),
              results: [
                {
                  opId: encodeTextToBase64('desktop-1'),
                  status: 'VFS_CRDT_PUSH_STATUS_APPLIED'
                }
              ]
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
        if (url.includes(`${VFS_V2_CONNECT_BASE_PATH}/GetCrdtSync`)) {
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
        if (url.endsWith(`${VFS_V2_CONNECT_BASE_PATH}/ReconcileCrdt`)) {
          return new Response(
            connectJsonEnvelope({
              clientId: encodeTextToBase64('desktop'),
              cursor: encodeVfsSyncCursor({
                changedAt: '2026-02-19T00:00:00.000Z',
                changeId: RECONCILE_CURSOR_CHANGE_ID
              }),
              lastReconciledWriteIds: { desktop: '1' }
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
          apiPrefix: ''
        }
      },
      blob: {
        baseUrl: 'http://localhost'
      }
    });

    const facade = createVfsSecureOrchestratorFacade(
      orchestrator,
      {
        uploadEncryptedBlob: vi.fn(),
        encryptCrdtOp: vi.fn(async () => ({
          encryptedOp: 'base64-encrypted-payload',
          opNonce: 'nonce-abc',
          opAad: 'aad-def',
          keyEpoch: 11,
          opSignature: 'sig-xyz'
        }))
      },
      { relationKind: 'file' }
    );

    await facade.queueEncryptedCrdtOpAndPersist({
      itemId: 'item-11',
      opType: 'link_add',
      opPayload: { parentId: 'parent-11', childId: 'item-11' }
    });

    expect(orchestrator.queuedCrdtOperations()).toHaveLength(1);

    await expect(orchestrator.flushAll()).resolves.toEqual({
      crdt: {
        pushedOperations: 1,
        pulledOperations: 0,
        pullPages: 1
      },
      blob: {
        processedOperations: 0,
        pendingOperations: 0
      }
    });

    const pushRequest = requests.find((request) =>
      request.url.endsWith(`${VFS_V2_CONNECT_BASE_PATH}/PushCrdtOps`)
    );
    expect(pushRequest).toBeDefined();

    if (
      !pushRequest ||
      typeof pushRequest.body !== 'object' ||
      pushRequest.body === null ||
      !('operations' in pushRequest.body) ||
      !Array.isArray(pushRequest.body['operations'])
    ) {
      throw new Error('expected push request body operations');
    }
    const pushedOp = pushRequest.body['operations'][0];
    expect(pushedOp).toEqual(
      expect.objectContaining({
        opId: ENCODED_DESKTOP_OP_ID,
        opType: LINK_ADD_OP_TYPE,
        itemId: ENCODED_ITEM_ID,
        replicaId: ENCODED_CLIENT_ID,
        writeId: '1',
        occurredAtMs: expect.any(String),
        encryptedPayload: 'base64-encrypted-payload',
        keyEpoch: 11,
        encryptionNonce: 'nonce-abc',
        encryptionAad: 'aad-def',
        encryptionSignature: 'sig-xyz'
      })
    );
  });
});
