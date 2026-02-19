import { describe, expect, it, vi } from 'vitest';
import { createVfsSecureOrchestratorFacade } from './secureOrchestratorFacade';
import type { EncryptedManifest } from './types';

describe('createVfsSecureOrchestratorFacade', () => {
  it('uploads encrypted blob and queues stage+attach operations', async () => {
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
    const queueBlobChunkAndPersist = vi.fn(async () => ({
      operationId: 'op-chunk-1',
      kind: 'chunk' as const,
      payload: {
        stagingId: 'stage-1',
        uploadId: 'upload-1',
        chunkIndex: 0,
        isFinal: false,
        nonce: 'nonce-1',
        aadHash: 'aad-hash-1',
        ciphertextBase64: 'Y2lwaGVydGV4dC0x',
        plaintextLength: 512,
        ciphertextLength: 576
      }
    }));
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

    const uploadEncryptedBlob = vi.fn(async () => ({
      manifest,
      uploadId: 'upload-1',
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
    }));
    const facade = createVfsSecureOrchestratorFacade(
      {
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

    expect(uploadEncryptedBlob).toHaveBeenCalledWith({
      itemId: 'item-1',
      blobId: 'blob-1',
      contentType: 'image/png',
      stream
    });
    expect(queueBlobChunkAndPersist).toHaveBeenCalledTimes(2);
    expect(queueBlobChunkAndPersist).toHaveBeenNthCalledWith(1, {
      stagingId: 'stage-1',
      uploadId: 'upload-1',
      chunkIndex: 0,
      isFinal: false,
      nonce: 'nonce-1',
      aadHash: 'aad-hash-1',
      ciphertextBase64: 'Y2lwaGVydGV4dC0x',
      plaintextLength: 512,
      ciphertextLength: 576
    });
    expect(queueBlobChunkAndPersist).toHaveBeenNthCalledWith(2, {
      stagingId: 'stage-1',
      uploadId: 'upload-1',
      chunkIndex: 1,
      isFinal: true,
      nonce: 'nonce-2',
      aadHash: 'aad-hash-2',
      ciphertextBase64: 'Y2lwaGVydGV4dC0y',
      plaintextLength: 512,
      ciphertextLength: 576
    });
    expect(queueBlobStageAndPersist).toHaveBeenCalledWith({
      blobId: 'blob-1',
      expiresAt: '2026-02-19T12:00:00.000Z',
      encryption: {
        algorithm: 'vfs-envelope-v1',
        keyEpoch: 4,
        manifestHash: 'manifest-signature-1',
        chunkCount: 2,
        chunkSizeBytes: 512,
        plaintextSizeBytes: 1024,
        ciphertextSizeBytes: 1152,
        checkpoint: {
          uploadId: 'blob-1',
          nextChunkIndex: 2
        }
      }
    });
    expect(queueBlobAttachAndPersist).toHaveBeenCalledWith({
      stagingId: 'stage-1',
      itemId: 'item-1',
      relationKind: 'photo'
    });
    expect(queueBlobManifestCommitAndPersist).toHaveBeenCalledWith({
      stagingId: 'stage-1',
      uploadId: 'upload-1',
      keyEpoch: 4,
      manifestHash: 'manifest-signature-1',
      manifestSignature: 'manifest-signature-1',
      chunkCount: 2,
      totalPlaintextBytes: 1024,
      totalCiphertextBytes: 1152
    });
    expect(result).toEqual({
      stagingId: 'stage-1',
      manifest
    });
  });

  it('throws for encrypted CRDT ops until schema support exists', async () => {
    const facade = createVfsSecureOrchestratorFacade(
      {
        queueBlobStageAndPersist: vi.fn(),
        queueBlobChunkAndPersist: vi.fn(),
        queueBlobManifestCommitAndPersist: vi.fn(),
        queueBlobAttachAndPersist: vi.fn()
      },
      {
        uploadEncryptedBlob: vi.fn(),
        encryptCrdtOp: vi.fn()
      }
    );

    await expect(
      facade.queueEncryptedCrdtOpAndPersist({
        itemId: 'item-1',
        opType: 'set_data',
        opPayload: { value: 'ciphertext' }
      })
    ).rejects.toThrow(
      'Encrypted CRDT ops are not yet supported by the current VFS CRDT operation schema'
    );
  });
});
