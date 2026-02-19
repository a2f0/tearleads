import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VfsCryptoEngine } from './vfsCrypto/engine';
import { VfsWriteOrchestrator } from './vfsWriteOrchestrator';

describe('vfsWriteOrchestrator secure facade runtime factory', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('creates a runtime secure facade that queues encrypted blob/crdt operations', async () => {
    const orchestrator = new VfsWriteOrchestrator('user-1', 'desktop');

    const encryptChunk = vi.fn(
      async ({
        chunkIndex,
        isFinal,
        plaintext
      }: {
        chunkIndex: number;
        isFinal: boolean;
        plaintext: Uint8Array;
      }) => ({
        chunkIndex,
        isFinal,
        nonce: `nonce-${chunkIndex}`,
        aadHash: `aad-${chunkIndex}`,
        ciphertext: plaintext.slice(),
        plaintextLength: plaintext.length,
        ciphertextLength: plaintext.length
      })
    );

    const facade = orchestrator.createSecureOrchestratorFacadeWithRuntime(
      {
        engine: {
          encryptChunk,
          decryptChunk: vi.fn(),
          signManifest: vi.fn(async () => 'manifest-signature'),
          verifyManifest: vi.fn()
        } satisfies VfsCryptoEngine,
        chunkSizeBytes: 8,
        resolveKeyEpoch: () => 5,
        createUploadId: () => 'upload-5'
      },
      {
        mapEncryptedCrdtOpToLocalOperation: ({ input, encrypted }) => ({
          opType: 'link_add',
          itemId: encrypted.encryptedOp,
          parentId: `enc-parent:${input.itemId}`,
          childId: encrypted.encryptedOp
        })
      }
    );

    await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'item-1',
      blobId: 'blob-1',
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3, 4]));
          controller.close();
        }
      }),
      expiresAt: '2026-02-19T12:00:00.000Z'
    });
    await facade.queueEncryptedCrdtOpAndPersist({
      itemId: 'item-1',
      opType: 'set_data',
      opPayload: { value: 'hello' }
    });

    expect(orchestrator.queuedBlobOperations()).toHaveLength(4);
    expect(orchestrator.queuedCrdtOperations()).toHaveLength(1);
  });
});
