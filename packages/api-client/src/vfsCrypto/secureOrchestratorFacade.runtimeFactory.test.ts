import { describe, expect, it, vi } from 'vitest';
import type { VfsCryptoEngine } from './engine';
import { createVfsSecureOrchestratorFacadeWithRuntime } from './secureOrchestratorFacade';

describe('secureOrchestratorFacade runtime factory', () => {
  it('builds facade with runtime pipeline and queues encrypted blob operations', async () => {
    const queueBlobStageAndPersist = vi.fn(async () => ({
      kind: 'stage' as const,
      id: 'op-stage-1',
      queuedAt: '2026-02-19T00:00:00.000Z',
      payload: {
        stagingId: 'stage-1',
        blobId: 'blob-1',
        expiresAt: '2026-02-19T12:00:00.000Z'
      }
    }));
    const queueBlobChunkAndPersist = vi.fn(async () => ({
      kind: 'chunk' as const,
      id: 'op-chunk-1',
      queuedAt: '2026-02-19T00:00:00.000Z',
      payload: {
        stagingId: 'stage-1',
        uploadId: 'upload-1',
        chunkIndex: 0,
        isFinal: true,
        nonce: 'nonce-1',
        aadHash: 'aad-1',
        ciphertextBase64: 'YQ==',
        plaintextLength: 1,
        ciphertextLength: 1
      }
    }));
    const queueBlobManifestCommitAndPersist = vi.fn(async () => ({
      kind: 'commit' as const,
      id: 'op-commit-1',
      queuedAt: '2026-02-19T00:00:00.000Z',
      payload: {
        stagingId: 'stage-1',
        uploadId: 'upload-1',
        keyEpoch: 3,
        manifestHash: 'manifest-sig-1',
        manifestSignature: 'manifest-sig-1',
        chunkCount: 2,
        totalPlaintextBytes: 5,
        totalCiphertextBytes: 9
      }
    }));
    const queueBlobAttachAndPersist = vi.fn(async () => ({
      kind: 'attach' as const,
      id: 'op-attach-1',
      queuedAt: '2026-02-19T00:00:00.000Z',
      payload: {
        stagingId: 'stage-1',
        itemId: 'item-1',
        relationKind: 'file' as const
      }
    }));
    const queueCrdtLocalOperationAndPersist = vi.fn();

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
        ciphertext: new Uint8Array(plaintext.length + 2),
        plaintextLength: plaintext.length,
        ciphertextLength: plaintext.length + 2
      })
    );
    const signManifest = vi.fn(async () => 'manifest-sig-1');

    const facade = createVfsSecureOrchestratorFacadeWithRuntime(
      {
        queueCrdtLocalOperationAndPersist,
        queueBlobStageAndPersist,
        queueBlobChunkAndPersist,
        queueBlobManifestCommitAndPersist,
        queueBlobAttachAndPersist
      },
      {
        engine: {
          encryptChunk,
          decryptChunk: vi.fn(),
          signManifest,
          verifyManifest: vi.fn()
        } satisfies VfsCryptoEngine,
        chunkSizeBytes: 4,
        resolveKeyEpoch: () => 3,
        createUploadId: () => 'upload-1'
      }
    );

    await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'item-1',
      blobId: 'blob-1',
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.enqueue(new Uint8Array([4, 5]));
          controller.close();
        }
      }),
      expiresAt: '2026-02-19T12:00:00.000Z'
    });

    expect(encryptChunk).toHaveBeenCalledTimes(2);
    expect(signManifest).toHaveBeenCalledTimes(1);
    expect(queueBlobStageAndPersist).toHaveBeenCalledTimes(1);
    expect(queueBlobChunkAndPersist).toHaveBeenCalledTimes(2);
    expect(queueBlobManifestCommitAndPersist).toHaveBeenCalledTimes(1);
    expect(queueBlobAttachAndPersist).toHaveBeenCalledTimes(1);
  });
});
