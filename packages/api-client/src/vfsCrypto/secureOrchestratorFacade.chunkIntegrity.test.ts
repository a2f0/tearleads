import { describe, expect, it, vi } from 'vitest';
import { createVfsSecureOrchestratorFacade } from './secureOrchestratorFacade';

describe('createVfsSecureOrchestratorFacade chunk integrity', () => {
  it('fails closed when chunks are not contiguous (gap in indexes)', async () => {
    const facade = createVfsSecureOrchestratorFacade(
      {
        queueCrdtLocalOperationAndPersist: vi.fn(),
        queueBlobStageAndPersist: vi.fn(),
        queueBlobChunkAndPersist: vi.fn(),
        queueBlobManifestCommitAndPersist: vi.fn(),
        queueBlobAttachAndPersist: vi.fn()
      },
      {
        uploadEncryptedBlob: vi.fn(async () => ({
          manifest: {
            itemId: 'item-1',
            blobId: 'blob-1',
            keyEpoch: 1,
            totalPlaintextBytes: 1024,
            totalCiphertextBytes: 1088,
            chunkCount: 2,
            chunkHashes: ['hash-1', 'hash-2'],
            wrappedFileKeys: [],
            manifestSignature: 'manifest-signature-1'
          },
          uploadId: 'upload-1',
          chunks: [
            {
              chunkIndex: 0,
              isFinal: false,
              nonce: 'nonce-1',
              aadHash: 'aad-hash-1',
              ciphertextBase64: 'YQ==',
              plaintextLength: 512,
              ciphertextLength: 544
            },
            {
              chunkIndex: 2,
              isFinal: true,
              nonce: 'nonce-2',
              aadHash: 'aad-hash-2',
              ciphertextBase64: 'Yg==',
              plaintextLength: 512,
              ciphertextLength: 544
            }
          ]
        })),
        encryptCrdtOp: vi.fn()
      }
    );

    await expect(
      facade.stageAttachEncryptedBlobAndPersist({
        itemId: 'item-1',
        blobId: 'blob-1',
        stream: new ReadableStream<Uint8Array>(),
        expiresAt: '2026-02-19T12:00:00.000Z'
      })
    ).rejects.toThrow(
      'Encrypted upload chunks must be contiguous from index 0'
    );
  });

  it('fails closed when chunks start at non-zero index', async () => {
    const facade = createVfsSecureOrchestratorFacade(
      {
        queueCrdtLocalOperationAndPersist: vi.fn(),
        queueBlobStageAndPersist: vi.fn(),
        queueBlobChunkAndPersist: vi.fn(),
        queueBlobManifestCommitAndPersist: vi.fn(),
        queueBlobAttachAndPersist: vi.fn()
      },
      {
        uploadEncryptedBlob: vi.fn(async () => ({
          manifest: {
            itemId: 'item-1',
            blobId: 'blob-1',
            keyEpoch: 1,
            totalPlaintextBytes: 512,
            totalCiphertextBytes: 544,
            chunkCount: 1,
            chunkHashes: ['hash-1'],
            wrappedFileKeys: [],
            manifestSignature: 'manifest-signature-1'
          },
          uploadId: 'upload-1',
          chunks: [
            {
              chunkIndex: 1,
              isFinal: true,
              nonce: 'nonce-1',
              aadHash: 'aad-hash-1',
              ciphertextBase64: 'YQ==',
              plaintextLength: 512,
              ciphertextLength: 544
            }
          ]
        })),
        encryptCrdtOp: vi.fn()
      }
    );

    await expect(
      facade.stageAttachEncryptedBlobAndPersist({
        itemId: 'item-1',
        blobId: 'blob-1',
        stream: new ReadableStream<Uint8Array>(),
        expiresAt: '2026-02-19T12:00:00.000Z'
      })
    ).rejects.toThrow(
      'Encrypted upload chunks must be contiguous from index 0'
    );
  });

  it('handles reordered chunks by sorting before validation', async () => {
    const queueBlobStageAndPersist = vi.fn(async () => ({
      operationId: 'op-stage-1',
      kind: 'stage' as const,
      payload: {
        stagingId: 'stage-1',
        blobId: 'blob-1',
        expiresAt: '2026-02-19T12:00:00.000Z'
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
        ciphertextBase64: 'YQ==',
        plaintextLength: 512,
        ciphertextLength: 544
      }
    }));
    const queueBlobManifestCommitAndPersist = vi.fn(async () => ({
      operationId: 'op-commit-1',
      kind: 'commit' as const,
      payload: {
        stagingId: 'stage-1',
        uploadId: 'upload-1',
        keyEpoch: 1,
        manifestHash: 'manifest-signature-1',
        manifestSignature: 'manifest-signature-1',
        chunkCount: 2,
        totalPlaintextBytes: 1024,
        totalCiphertextBytes: 1088
      }
    }));
    const queueBlobAttachAndPersist = vi.fn(async () => ({
      operationId: 'op-attach-1',
      kind: 'attach' as const,
      payload: {
        stagingId: 'stage-1',
        itemId: 'item-1',
        relationKind: 'file' as const
      }
    }));

    const facade = createVfsSecureOrchestratorFacade(
      {
        queueCrdtLocalOperationAndPersist: vi.fn(),
        queueBlobStageAndPersist,
        queueBlobChunkAndPersist,
        queueBlobManifestCommitAndPersist,
        queueBlobAttachAndPersist
      },
      {
        uploadEncryptedBlob: vi.fn(async () => ({
          manifest: {
            itemId: 'item-1',
            blobId: 'blob-1',
            keyEpoch: 1,
            totalPlaintextBytes: 1024,
            totalCiphertextBytes: 1088,
            chunkCount: 2,
            chunkHashes: ['hash-1', 'hash-2'],
            wrappedFileKeys: [],
            manifestSignature: 'manifest-signature-1'
          },
          uploadId: 'upload-1',
          chunks: [
            {
              chunkIndex: 1,
              isFinal: true,
              nonce: 'nonce-2',
              aadHash: 'aad-hash-2',
              ciphertextBase64: 'Yg==',
              plaintextLength: 512,
              ciphertextLength: 544
            },
            {
              chunkIndex: 0,
              isFinal: false,
              nonce: 'nonce-1',
              aadHash: 'aad-hash-1',
              ciphertextBase64: 'YQ==',
              plaintextLength: 512,
              ciphertextLength: 544
            }
          ]
        })),
        encryptCrdtOp: vi.fn()
      }
    );

    const result = await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'item-1',
      blobId: 'blob-1',
      stream: new ReadableStream<Uint8Array>(),
      expiresAt: '2026-02-19T12:00:00.000Z'
    });

    expect(result.stagingId).toBe('stage-1');
    expect(queueBlobChunkAndPersist).toHaveBeenCalledTimes(2);
  });
});
