import { describe, expect, it, vi } from 'vitest';
import { createVfsSecureOrchestratorFacade } from './secureOrchestratorFacade';
import type { EncryptedManifest } from './types';

describe('createVfsSecureOrchestratorFacade', () => {
  it('uploads encrypted blob and queues stage+attach operations', async () => {
    const queueCrdtLocalOperationAndPersist = vi.fn(async () => ({
      opId: 'desktop:1',
      opType: 'link_add' as const,
      itemId: 'item-1',
      replicaId: 'desktop',
      writeId: 1,
      occurredAt: '2026-02-19T12:00:00.000Z',
      parentId: 'parent-1',
      childId: 'child-1'
    }));
    const queueBlobStageAndPersist = vi.fn(async () => ({
      operationId: 'op-stage-1',
      kind: 'stage' as const,
      payload: {
        stagingId: 'stage-1',
        blobId: 'blob-1',
        expiresAt: '2026-02-19T12:00:00.000Z'
      }
    }));
    const queueBlobAttachAndPersist = vi.fn(async () => ({
      operationId: 'op-attach-1',
      kind: 'attach' as const,
      payload: {
        stagingId: 'stage-1',
        itemId: 'item-1',
        relationKind: 'photo' as const
      }
    }));

    const queuedChunks: Array<{
      stagingId: string;
      uploadId: string;
      chunkIndex: number;
    }> = [];
    const queueBlobChunkAndPersist = vi.fn(async (input) => {
      queuedChunks.push({
        stagingId: input.stagingId,
        uploadId: input.uploadId,
        chunkIndex: input.chunkIndex
      });
      return {
        operationId: `op-chunk-${input.chunkIndex}`,
        kind: 'chunk' as const,
        payload: input
      };
    });
    const queueBlobManifestCommitAndPersist = vi.fn(async () => ({
      operationId: 'op-commit-1',
      kind: 'commit' as const,
      payload: {
        stagingId: 'stage-1',
        uploadId: 'blob-1',
        keyEpoch: 4,
        manifestHash: 'manifest-signature-1',
        manifestSignature: 'manifest-signature-1',
        chunkCount: 2,
        totalPlaintextBytes: 1024,
        totalCiphertextBytes: 1152
      }
    }));

    const manifest: EncryptedManifest = {
      itemId: 'item-1',
      blobId: 'blob-1',
      keyEpoch: 4,
      contentType: 'image/png',
      totalPlaintextBytes: 1024,
      totalCiphertextBytes: 1152,
      chunkCount: 2,
      chunkHashes: ['hash-1', 'hash-2'],
      wrappedFileKeys: [],
      manifestSignature: 'manifest-signature-1'
    };

    const uploadEncryptedBlob = vi.fn(async (input) => {
      // Simulate streaming chunks via callback
      await input.onChunk!({
        chunkIndex: 0,
        isFinal: false,
        nonce: 'nonce-1',
        aadHash: 'aad-hash-1',
        ciphertextBase64: 'Y2lwaGVydGV4dC0x',
        plaintextLength: 512,
        ciphertextLength: 576
      });
      await input.onChunk!({
        chunkIndex: 1,
        isFinal: true,
        nonce: 'nonce-2',
        aadHash: 'aad-hash-2',
        ciphertextBase64: 'Y2lwaGVydGV4dC0y',
        plaintextLength: 512,
        ciphertextLength: 576
      });

      return {
        manifest,
        uploadId: 'upload-1'
      };
    });
    const facade = createVfsSecureOrchestratorFacade(
      {
        queueCrdtLocalOperationAndPersist,
        queueBlobStageAndPersist,
        queueBlobChunkAndPersist,
        queueBlobManifestCommitAndPersist,
        queueBlobAttachAndPersist
      },
      {
        uploadEncryptedBlob,
        encryptCrdtOp: vi.fn()
      },
      {
        relationKind: 'photo'
      }
    );

    const stream = new ReadableStream<Uint8Array>();
    const result = await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'item-1',
      blobId: 'blob-1',
      contentType: 'image/png',
      stream,
      expiresAt: '2026-02-19T12:00:00.000Z'
    });

    expect(uploadEncryptedBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'item-1',
        blobId: 'blob-1',
        contentType: 'image/png',
        stream,
        onChunk: expect.any(Function)
      })
    );
    expect(queueBlobChunkAndPersist).toHaveBeenCalledTimes(2);
    expect(queuedChunks[0]?.chunkIndex).toBe(0);
    expect(queuedChunks[1]?.chunkIndex).toBe(1);
    expect(queueBlobStageAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        blobId: 'blob-1',
        expiresAt: '2026-02-19T12:00:00.000Z',
        encryption: expect.objectContaining({
          algorithm: 'vfs-envelope-v1',
          keyEpoch: 4,
          manifestHash: 'manifest-signature-1',
          chunkCount: 2,
          chunkSizeBytes: 512,
          plaintextSizeBytes: 1024,
          ciphertextSizeBytes: 1152
        })
      })
    );
    expect(queueBlobAttachAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'item-1',
        relationKind: 'photo'
      })
    );
    expect(queueBlobManifestCommitAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        keyEpoch: 4,
        manifestHash: 'manifest-signature-1',
        manifestSignature: 'manifest-signature-1',
        chunkCount: 2,
        totalPlaintextBytes: 1024,
        totalCiphertextBytes: 1152
      })
    );
    expect(result.stagingId).toBeTruthy();
    expect(result.manifest).toEqual(manifest);
  });

  it('queues encrypted CRDT ops with default mapper', async () => {
    const queueCrdtLocalOperationAndPersist = vi.fn(async () => ({
      opId: 'desktop:1',
      opType: 'link_add' as const,
      itemId: 'item-1',
      replicaId: 'desktop',
      writeId: 1,
      occurredAt: '2026-02-19T12:00:00.000Z',
      parentId: 'parent-1',
      childId: 'item-1',
      encryptedPayload: 'encrypted-payload',
      keyEpoch: 1,
      encryptionNonce: 'nonce-1',
      encryptionAad: 'aad-1',
      encryptionSignature: 'sig-1'
    }));

    const encryptCrdtOp = vi.fn(async () => ({
      encryptedOp: 'encrypted-payload',
      opNonce: 'nonce-1',
      opAad: 'aad-1',
      keyEpoch: 1,
      opSignature: 'sig-1'
    }));

    const facade = createVfsSecureOrchestratorFacade(
      {
        queueCrdtLocalOperationAndPersist,
        queueBlobStageAndPersist: vi.fn(),
        queueBlobChunkAndPersist: vi.fn(),
        queueBlobManifestCommitAndPersist: vi.fn(),
        queueBlobAttachAndPersist: vi.fn()
      },
      {
        uploadEncryptedBlob: vi.fn(),
        encryptCrdtOp
      }
    );

    await facade.queueEncryptedCrdtOpAndPersist({
      itemId: 'item-1',
      opType: 'link_add',
      opPayload: { parentId: 'parent-1', childId: 'item-1' }
    });

    expect(encryptCrdtOp).toHaveBeenCalledWith({
      itemId: 'item-1',
      opType: 'link_add',
      opPayload: { parentId: 'parent-1', childId: 'item-1' }
    });

    expect(queueCrdtLocalOperationAndPersist).toHaveBeenCalledWith({
      opType: 'link_add',
      itemId: 'item-1',
      encryptedPayload: 'encrypted-payload',
      keyEpoch: 1,
      encryptionNonce: 'nonce-1',
      encryptionAad: 'aad-1',
      encryptionSignature: 'sig-1'
    });
  });

  it('queues encrypted CRDT operations when mapper is provided', async () => {
    const queueCrdtLocalOperationAndPersist = vi.fn(async () => ({
      opId: 'desktop:1',
      opType: 'link_add' as const,
      itemId: 'item-1',
      replicaId: 'desktop',
      writeId: 1,
      occurredAt: '2026-02-19T12:00:00.000Z',
      parentId: 'enc-parent:4',
      childId: 'ciphertext-1'
    }));
    const encryptCrdtOp = vi.fn(async () => ({
      encryptedOp: 'ciphertext-1',
      opNonce: 'nonce-1',
      opAad: 'aad-1',
      keyEpoch: 4,
      opSignature: 'sig-1'
    }));

    const facade = createVfsSecureOrchestratorFacade(
      {
        queueCrdtLocalOperationAndPersist,
        queueBlobStageAndPersist: vi.fn(),
        queueBlobChunkAndPersist: vi.fn(),
        queueBlobManifestCommitAndPersist: vi.fn(),
        queueBlobAttachAndPersist: vi.fn()
      },
      {
        uploadEncryptedBlob: vi.fn(),
        encryptCrdtOp
      },
      {
        mapEncryptedCrdtOpToLocalOperation: ({ input, encrypted }) => ({
          opType: 'link_add',
          itemId: input.itemId,
          parentId: `enc-parent:${encrypted.keyEpoch}`,
          childId: encrypted.encryptedOp
        })
      }
    );

    await facade.queueEncryptedCrdtOpAndPersist({
      itemId: 'item-1',
      opType: 'link_add',
      opPayload: { parentId: 'parent-1', childId: 'item-1' }
    });

    expect(encryptCrdtOp).toHaveBeenCalledWith({
      itemId: 'item-1',
      opType: 'link_add',
      opPayload: { parentId: 'parent-1', childId: 'item-1' }
    });
    expect(queueCrdtLocalOperationAndPersist).toHaveBeenCalledWith({
      opType: 'link_add',
      itemId: 'item-1',
      parentId: 'enc-parent:4',
      childId: 'ciphertext-1'
    });
  });
});
