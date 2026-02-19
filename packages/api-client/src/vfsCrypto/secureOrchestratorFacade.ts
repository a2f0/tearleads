import type {
  VfsBlobRelationKind,
  VfsBlobStageRequest
} from '../vfsBlobNetworkFlusher';
import type { VfsWriteOrchestrator } from '../vfsWriteOrchestrator';
import type {
  QueueEncryptedCrdtOpAndPersistInput,
  StageAttachEncryptedBlobAndPersistInput,
  StageAttachEncryptedBlobAndPersistResult,
  VfsSecureOrchestratorFacade,
  VfsSecureWritePipeline
} from './secureWritePipeline';

export interface VfsSecureOrchestratorFacadeOptions {
  relationKind?: VfsBlobRelationKind;
}

export function createVfsSecureOrchestratorFacade(
  writeOrchestrator: Pick<
    VfsWriteOrchestrator,
    | 'queueBlobStageAndPersist'
    | 'queueBlobChunkAndPersist'
    | 'queueBlobManifestCommitAndPersist'
    | 'queueBlobAttachAndPersist'
  >,
  secureWritePipeline: VfsSecureWritePipeline,
  options: VfsSecureOrchestratorFacadeOptions = {}
): VfsSecureOrchestratorFacade {
  return new DefaultVfsSecureOrchestratorFacade(
    writeOrchestrator,
    secureWritePipeline,
    options
  );
}

class DefaultVfsSecureOrchestratorFacade
  implements VfsSecureOrchestratorFacade
{
  private readonly relationKind: VfsBlobRelationKind;

  constructor(
    private readonly writeOrchestrator: Pick<
      VfsWriteOrchestrator,
      | 'queueBlobStageAndPersist'
      | 'queueBlobChunkAndPersist'
      | 'queueBlobManifestCommitAndPersist'
      | 'queueBlobAttachAndPersist'
    >,
    private readonly secureWritePipeline: VfsSecureWritePipeline,
    options: VfsSecureOrchestratorFacadeOptions
  ) {
    this.relationKind = options.relationKind ?? 'file';
  }

  async queueEncryptedCrdtOpAndPersist(
    _input: QueueEncryptedCrdtOpAndPersistInput
  ): Promise<void> {
    throw new Error(
      'Encrypted CRDT ops are not yet supported by the current VFS CRDT operation schema'
    );
  }

  async stageAttachEncryptedBlobAndPersist(
    input: StageAttachEncryptedBlobAndPersistInput
  ): Promise<StageAttachEncryptedBlobAndPersistResult> {
    const uploadResult = await this.secureWritePipeline.uploadEncryptedBlob({
      itemId: input.itemId,
      blobId: input.blobId,
      contentType: input.contentType,
      stream: input.stream
    });
    const { manifest } = uploadResult;

    const stageRequest: VfsBlobStageRequest = {
      blobId: input.blobId,
      expiresAt: input.expiresAt,
      encryption: {
        algorithm: 'vfs-envelope-v1',
        keyEpoch: manifest.keyEpoch,
        manifestHash: manifest.manifestSignature,
        chunkCount: manifest.chunkCount,
        chunkSizeBytes: estimateChunkSizeBytes(
          manifest.totalPlaintextBytes,
          manifest.chunkCount
        ),
        plaintextSizeBytes: manifest.totalPlaintextBytes,
        ciphertextSizeBytes: manifest.totalCiphertextBytes,
        checkpoint: {
          uploadId: manifest.blobId,
          nextChunkIndex: manifest.chunkCount
        }
      }
    };

    const stageOperation =
      await this.writeOrchestrator.queueBlobStageAndPersist(stageRequest);
    const stagingId = stageOperation.payload.stagingId;
    const uploadId = uploadResult.uploadId ?? manifest.blobId;

    for (const chunk of uploadResult.chunks ?? []) {
      await this.writeOrchestrator.queueBlobChunkAndPersist({
        stagingId,
        uploadId,
        chunkIndex: chunk.chunkIndex,
        isFinal: chunk.isFinal,
        nonce: chunk.nonce,
        aadHash: chunk.aadHash,
        ciphertextBase64: chunk.ciphertextBase64,
        plaintextLength: chunk.plaintextLength,
        ciphertextLength: chunk.ciphertextLength
      });
    }

    await this.writeOrchestrator.queueBlobManifestCommitAndPersist({
      stagingId,
      uploadId,
      keyEpoch: manifest.keyEpoch,
      manifestHash: manifest.manifestSignature,
      manifestSignature: manifest.manifestSignature,
      chunkCount: manifest.chunkCount,
      totalPlaintextBytes: manifest.totalPlaintextBytes,
      totalCiphertextBytes: manifest.totalCiphertextBytes
    });

    await this.writeOrchestrator.queueBlobAttachAndPersist({
      stagingId,
      itemId: input.itemId,
      relationKind: this.relationKind
    });

    return {
      stagingId,
      manifest
    };
  }
}

function estimateChunkSizeBytes(
  totalPlaintextBytes: number,
  chunkCount: number
): number {
  if (chunkCount <= 0) {
    return 1;
  }

  const estimated = Math.ceil(totalPlaintextBytes / chunkCount);
  return Math.max(1, estimated);
}
