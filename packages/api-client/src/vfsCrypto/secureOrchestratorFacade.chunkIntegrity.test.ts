import { describe, expect, it, vi } from 'vitest';
import { createVfsSecureOrchestratorFacade } from './secureOrchestratorFacade';

describe('createVfsSecureOrchestratorFacade streaming chunk integrity', () => {
  it('validates streamed chunks are contiguous from index 0', async () => {
    const queueBlobStageAndPersist = vi.fn(async () => ({
      operationId: 'op-stage-1',
      kind: 'stage' as const,
      payload: {}
    }));
    const queueBlobChunkAndPersist = vi.fn(async () => ({
      operationId: 'op-chunk-1',
      kind: 'chunk' as const,
      payload: {}
    }));
    const queueBlobManifestCommitAndPersist = vi.fn(async () => ({
      operationId: 'op-commit-1',
      kind: 'commit' as const,
      payload: {}
    }));
    const queueBlobAttachAndPersist = vi.fn(async () => ({
      operationId: 'op-attach-1',
      kind: 'attach' as const,
      payload: {}
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
        uploadEncryptedBlob: vi.fn(async (input) => {
          // Simulate streaming chunks via callback
          await input.onChunk?.({
            chunkIndex: 0,
            isFinal: false,
            nonce: 'nonce-0',
            aadHash: 'aad-0',
            ciphertextBase64: 'YQ==',
            plaintextLength: 512,
            ciphertextLength: 544
          });
          await input.onChunk?.({
            chunkIndex: 1,
            isFinal: true,
            nonce: 'nonce-1',
            aadHash: 'aad-1',
            ciphertextBase64: 'Yg==',
            plaintextLength: 512,
            ciphertextLength: 544
          });

          return {
            manifest: {
              itemId: 'item-1',
              blobId: 'blob-1',
              keyEpoch: 1,
              totalPlaintextBytes: 1024,
              totalCiphertextBytes: 1088,
              chunkCount: 2,
              chunkHashes: ['hash-0', 'hash-1'],
              wrappedFileKeys: [],
              manifestSignature: 'manifest-sig'
            },
            uploadId: 'upload-1'
          };
        }),
        encryptCrdtOp: vi.fn()
      }
    );

    const result = await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'item-1',
      blobId: 'blob-1',
      stream: new ReadableStream<Uint8Array>(),
      expiresAt: '2026-02-19T12:00:00.000Z'
    });

    expect(result.stagingId).toBeTruthy();
    expect(queueBlobChunkAndPersist).toHaveBeenCalledTimes(2);
    expect(queueBlobStageAndPersist).toHaveBeenCalledTimes(1);
    expect(queueBlobManifestCommitAndPersist).toHaveBeenCalledTimes(1);
    expect(queueBlobAttachAndPersist).toHaveBeenCalledTimes(1);
  });

  it('fails when streamed chunk count mismatches manifest', async () => {
    const facade = createVfsSecureOrchestratorFacade(
      {
        queueCrdtLocalOperationAndPersist: vi.fn(),
        queueBlobStageAndPersist: vi.fn(),
        queueBlobChunkAndPersist: vi.fn(),
        queueBlobManifestCommitAndPersist: vi.fn(),
        queueBlobAttachAndPersist: vi.fn()
      },
      {
        uploadEncryptedBlob: vi.fn(async (input) => {
          // Only emit 1 chunk but manifest says 2
          await input.onChunk?.({
            chunkIndex: 0,
            isFinal: true,
            nonce: 'nonce-0',
            aadHash: 'aad-0',
            ciphertextBase64: 'YQ==',
            plaintextLength: 512,
            ciphertextLength: 544
          });

          return {
            manifest: {
              itemId: 'item-1',
              blobId: 'blob-1',
              keyEpoch: 1,
              totalPlaintextBytes: 1024,
              totalCiphertextBytes: 1088,
              chunkCount: 2,
              chunkHashes: ['hash-0', 'hash-1'],
              wrappedFileKeys: [],
              manifestSignature: 'manifest-sig'
            },
            uploadId: 'upload-1'
          };
        }),
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
    ).rejects.toThrow('Streamed chunks do not match manifest chunkCount');
  });

  it('fails when streamed chunks have gap in indexes', async () => {
    const facade = createVfsSecureOrchestratorFacade(
      {
        queueCrdtLocalOperationAndPersist: vi.fn(),
        queueBlobStageAndPersist: vi.fn(),
        queueBlobChunkAndPersist: vi.fn(),
        queueBlobManifestCommitAndPersist: vi.fn(),
        queueBlobAttachAndPersist: vi.fn()
      },
      {
        uploadEncryptedBlob: vi.fn(async (input) => {
          // Emit chunks with gap (0, 2 instead of 0, 1)
          await input.onChunk?.({
            chunkIndex: 0,
            isFinal: false,
            nonce: 'nonce-0',
            aadHash: 'aad-0',
            ciphertextBase64: 'YQ==',
            plaintextLength: 512,
            ciphertextLength: 544
          });
          await input.onChunk?.({
            chunkIndex: 2,
            isFinal: true,
            nonce: 'nonce-2',
            aadHash: 'aad-2',
            ciphertextBase64: 'Yg==',
            plaintextLength: 512,
            ciphertextLength: 544
          });

          return {
            manifest: {
              itemId: 'item-1',
              blobId: 'blob-1',
              keyEpoch: 1,
              totalPlaintextBytes: 1024,
              totalCiphertextBytes: 1088,
              chunkCount: 2,
              chunkHashes: ['hash-0', 'hash-2'],
              wrappedFileKeys: [],
              manifestSignature: 'manifest-sig'
            },
            uploadId: 'upload-1'
          };
        }),
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
    ).rejects.toThrow('Streamed chunks must be contiguous from index 0');
  });

  it('fails when streamed chunks start at non-zero index', async () => {
    const facade = createVfsSecureOrchestratorFacade(
      {
        queueCrdtLocalOperationAndPersist: vi.fn(),
        queueBlobStageAndPersist: vi.fn(),
        queueBlobChunkAndPersist: vi.fn(),
        queueBlobManifestCommitAndPersist: vi.fn(),
        queueBlobAttachAndPersist: vi.fn()
      },
      {
        uploadEncryptedBlob: vi.fn(async (input) => {
          // Start at index 1 instead of 0
          await input.onChunk?.({
            chunkIndex: 1,
            isFinal: true,
            nonce: 'nonce-1',
            aadHash: 'aad-1',
            ciphertextBase64: 'YQ==',
            plaintextLength: 512,
            ciphertextLength: 544
          });

          return {
            manifest: {
              itemId: 'item-1',
              blobId: 'blob-1',
              keyEpoch: 1,
              totalPlaintextBytes: 512,
              totalCiphertextBytes: 544,
              chunkCount: 1,
              chunkHashes: ['hash-1'],
              wrappedFileKeys: [],
              manifestSignature: 'manifest-sig'
            },
            uploadId: 'upload-1'
          };
        }),
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
    ).rejects.toThrow('Streamed chunks must be contiguous from index 0');
  });

  it('fails when finality metadata is invalid', async () => {
    const facade = createVfsSecureOrchestratorFacade(
      {
        queueCrdtLocalOperationAndPersist: vi.fn(),
        queueBlobStageAndPersist: vi.fn(),
        queueBlobChunkAndPersist: vi.fn(),
        queueBlobManifestCommitAndPersist: vi.fn(),
        queueBlobAttachAndPersist: vi.fn()
      },
      {
        uploadEncryptedBlob: vi.fn(async (input) => {
          // Chunk 0 is marked as final but there's another chunk
          await input.onChunk?.({
            chunkIndex: 0,
            isFinal: true,
            nonce: 'nonce-0',
            aadHash: 'aad-0',
            ciphertextBase64: 'YQ==',
            plaintextLength: 512,
            ciphertextLength: 544
          });
          await input.onChunk?.({
            chunkIndex: 1,
            isFinal: true,
            nonce: 'nonce-1',
            aadHash: 'aad-1',
            ciphertextBase64: 'Yg==',
            plaintextLength: 512,
            ciphertextLength: 544
          });

          return {
            manifest: {
              itemId: 'item-1',
              blobId: 'blob-1',
              keyEpoch: 1,
              totalPlaintextBytes: 1024,
              totalCiphertextBytes: 1088,
              chunkCount: 2,
              chunkHashes: ['hash-0', 'hash-1'],
              wrappedFileKeys: [],
              manifestSignature: 'manifest-sig'
            },
            uploadId: 'upload-1'
          };
        }),
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
    ).rejects.toThrow('Streamed chunk finality metadata is invalid');
  });

  it('queues chunks immediately as they stream', async () => {
    const _queueBlobChunkAndPersist = vi.fn(async () => ({
      operationId: 'op-chunk',
      kind: 'chunk' as const,
      payload: {}
    }));

    const chunkQueueOrder: number[] = [];

    const facade = createVfsSecureOrchestratorFacade(
      {
        queueCrdtLocalOperationAndPersist: vi.fn(),
        queueBlobStageAndPersist: vi.fn(async () => ({
          operationId: 'op-stage',
          kind: 'stage' as const,
          payload: {}
        })),
        queueBlobChunkAndPersist: vi.fn(async (input) => {
          chunkQueueOrder.push(input.chunkIndex);
          return {
            operationId: `op-chunk-${input.chunkIndex}`,
            kind: 'chunk' as const,
            payload: {}
          };
        }),
        queueBlobManifestCommitAndPersist: vi.fn(async () => ({
          operationId: 'op-commit',
          kind: 'commit' as const,
          payload: {}
        })),
        queueBlobAttachAndPersist: vi.fn(async () => ({
          operationId: 'op-attach',
          kind: 'attach' as const,
          payload: {}
        }))
      },
      {
        uploadEncryptedBlob: vi.fn(async (input) => {
          // Simulate streaming 3 chunks
          for (let i = 0; i < 3; i++) {
            await input.onChunk?.({
              chunkIndex: i,
              isFinal: i === 2,
              nonce: `nonce-${i}`,
              aadHash: `aad-${i}`,
              ciphertextBase64: 'YQ==',
              plaintextLength: 100,
              ciphertextLength: 116
            });
          }

          return {
            manifest: {
              itemId: 'item-1',
              blobId: 'blob-1',
              keyEpoch: 1,
              totalPlaintextBytes: 300,
              totalCiphertextBytes: 348,
              chunkCount: 3,
              chunkHashes: ['h0', 'h1', 'h2'],
              wrappedFileKeys: [],
              manifestSignature: 'sig'
            },
            uploadId: 'upload-1'
          };
        }),
        encryptCrdtOp: vi.fn()
      }
    );

    await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'item-1',
      blobId: 'blob-1',
      stream: new ReadableStream<Uint8Array>(),
      expiresAt: '2026-02-19T12:00:00.000Z'
    });

    expect(chunkQueueOrder).toEqual([0, 1, 2]);
  });

  it('uses pre-generated stagingId and uploadId for chunk queuing', async () => {
    const queuedChunks: Array<{
      stagingId: string;
      uploadId: string;
      chunkIndex: number;
    }> = [];

    const facade = createVfsSecureOrchestratorFacade(
      {
        queueCrdtLocalOperationAndPersist: vi.fn(),
        queueBlobStageAndPersist: vi.fn(async () => ({
          operationId: 'op-stage',
          kind: 'stage' as const,
          payload: {}
        })),
        queueBlobChunkAndPersist: vi.fn(async (input) => {
          queuedChunks.push({
            stagingId: input.stagingId,
            uploadId: input.uploadId,
            chunkIndex: input.chunkIndex
          });
          return {
            operationId: 'op-chunk',
            kind: 'chunk' as const,
            payload: {}
          };
        }),
        queueBlobManifestCommitAndPersist: vi.fn(async () => ({
          operationId: 'op-commit',
          kind: 'commit' as const,
          payload: {}
        })),
        queueBlobAttachAndPersist: vi.fn(async () => ({
          operationId: 'op-attach',
          kind: 'attach' as const,
          payload: {}
        }))
      },
      {
        uploadEncryptedBlob: vi.fn(async (input) => {
          await input.onChunk?.({
            chunkIndex: 0,
            isFinal: false,
            nonce: 'n0',
            aadHash: 'a0',
            ciphertextBase64: 'YQ==',
            plaintextLength: 100,
            ciphertextLength: 116
          });
          await input.onChunk?.({
            chunkIndex: 1,
            isFinal: true,
            nonce: 'n1',
            aadHash: 'a1',
            ciphertextBase64: 'Yg==',
            plaintextLength: 100,
            ciphertextLength: 116
          });

          return {
            manifest: {
              itemId: 'item-1',
              blobId: 'blob-1',
              keyEpoch: 1,
              totalPlaintextBytes: 200,
              totalCiphertextBytes: 232,
              chunkCount: 2,
              chunkHashes: ['h0', 'h1'],
              wrappedFileKeys: [],
              manifestSignature: 'sig'
            },
            uploadId: 'upload-1'
          };
        }),
        encryptCrdtOp: vi.fn()
      }
    );

    const result = await facade.stageAttachEncryptedBlobAndPersist({
      itemId: 'item-1',
      blobId: 'blob-1',
      stream: new ReadableStream<Uint8Array>(),
      expiresAt: '2026-02-19T12:00:00.000Z'
    });

    expect(queuedChunks).toHaveLength(2);
    expect(queuedChunks[0]?.stagingId).toBe(result.stagingId);
    expect(queuedChunks[1]?.stagingId).toBe(result.stagingId);
    expect(queuedChunks[0]?.uploadId).toBe(queuedChunks[1]?.uploadId);
  });
});
