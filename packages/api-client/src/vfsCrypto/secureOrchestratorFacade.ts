import type { QueueVfsCrdtLocalOperationInput } from '@tearleads/vfs-sync/vfs';
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
import {
  createVfsSecureWritePipeline,
  type VfsSecureWritePipelineRuntimeOptions
} from './secureWritePipelineRuntime';

export interface VfsSecureOrchestratorFacadeOptions {
  relationKind?: VfsBlobRelationKind;
  mapEncryptedCrdtOpToLocalOperation?: (
    input: MapEncryptedCrdtOpToLocalOperationInput
  ) => QueueVfsCrdtLocalOperationInput;
}

export interface MapEncryptedCrdtOpToLocalOperationInput {
  input: QueueEncryptedCrdtOpAndPersistInput;
  encrypted: Awaited<ReturnType<VfsSecureWritePipeline['encryptCrdtOp']>>;
}

type SecureOrchestratorFacadeWriteOrchestrator = Pick<
  VfsWriteOrchestrator,
  | 'queueCrdtLocalOperationAndPersist'
  | 'queueBlobStageAndPersist'
  | 'queueBlobChunkAndPersist'
  | 'queueBlobManifestCommitAndPersist'
  | 'queueBlobAttachAndPersist'
>;

export function createVfsSecureOrchestratorFacade(
  writeOrchestrator: SecureOrchestratorFacadeWriteOrchestrator,
  secureWritePipeline: VfsSecureWritePipeline,
  options: VfsSecureOrchestratorFacadeOptions = {}
): VfsSecureOrchestratorFacade {
  return new DefaultVfsSecureOrchestratorFacade(
    writeOrchestrator,
    secureWritePipeline,
    options
  );
}

export function createVfsSecureOrchestratorFacadeWithRuntime(
  writeOrchestrator: SecureOrchestratorFacadeWriteOrchestrator,
  runtimeOptions: VfsSecureWritePipelineRuntimeOptions,
  options: VfsSecureOrchestratorFacadeOptions = {}
): VfsSecureOrchestratorFacade {
  const secureWritePipeline = createVfsSecureWritePipeline(runtimeOptions);
  return createVfsSecureOrchestratorFacade(
    writeOrchestrator,
    secureWritePipeline,
    options
  );
}

class DefaultVfsSecureOrchestratorFacade
  implements VfsSecureOrchestratorFacade
{
  private readonly relationKind: VfsBlobRelationKind;
  private readonly mapEncryptedCrdtOpToLocalOperation:
    | ((
        input: MapEncryptedCrdtOpToLocalOperationInput
      ) => QueueVfsCrdtLocalOperationInput)
    | null;

  constructor(
    private readonly writeOrchestrator: SecureOrchestratorFacadeWriteOrchestrator,
    private readonly secureWritePipeline: VfsSecureWritePipeline,
    options: VfsSecureOrchestratorFacadeOptions
  ) {
    this.relationKind = options.relationKind ?? 'file';
    this.mapEncryptedCrdtOpToLocalOperation =
      options.mapEncryptedCrdtOpToLocalOperation ?? null;
  }

  async queueEncryptedCrdtOpAndPersist(
    input: QueueEncryptedCrdtOpAndPersistInput
  ): Promise<void> {
    const encrypted = await this.secureWritePipeline.encryptCrdtOp({
      itemId: input.itemId,
      opType: input.opType,
      opPayload: input.opPayload
    });

    const localOperation = this.mapEncryptedCrdtOpToLocalOperation
      ? this.mapEncryptedCrdtOpToLocalOperation({ input, encrypted })
      : defaultMapEncryptedCrdtOpToLocalOperation({ input, encrypted });

    await this.writeOrchestrator.queueCrdtLocalOperationAndPersist(
      localOperation
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
    const uploadId = uploadResult.uploadId ?? manifest.blobId;
    const chunks = uploadResult.chunks ?? [];
    validateUploadChunkIntegrity(chunks, manifest);

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
          uploadId,
          nextChunkIndex: manifest.chunkCount
        }
      }
    };

    const stageOperation =
      await this.writeOrchestrator.queueBlobStageAndPersist(stageRequest);
    const stagingId = stageOperation.payload.stagingId;

    for (const chunk of chunks) {
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

function validateUploadChunkIntegrity(
  chunks: NonNullable<
    Awaited<ReturnType<VfsSecureWritePipeline['uploadEncryptedBlob']>>['chunks']
  >,
  manifest: Awaited<
    ReturnType<VfsSecureWritePipeline['uploadEncryptedBlob']>
  >['manifest']
): void {
  if (chunks.length === 0) {
    return;
  }

  if (chunks.length !== manifest.chunkCount) {
    throw new Error('Encrypted upload chunks do not match manifest chunkCount');
  }

  const sortedChunks = [...chunks].sort((left, right) => {
    return left.chunkIndex - right.chunkIndex;
  });
  for (const [index, chunk] of sortedChunks.entries()) {
    if (chunk.chunkIndex !== index) {
      throw new Error(
        'Encrypted upload chunks must be contiguous from index 0'
      );
    }
    const shouldBeFinal = index === sortedChunks.length - 1;
    if (chunk.isFinal !== shouldBeFinal) {
      throw new Error('Encrypted upload chunk finality metadata is invalid');
    }
  }

  const totalPlaintextBytes = sortedChunks.reduce((total, chunk) => {
    return total + chunk.plaintextLength;
  }, 0);
  const totalCiphertextBytes = sortedChunks.reduce((total, chunk) => {
    return total + chunk.ciphertextLength;
  }, 0);
  if (
    totalPlaintextBytes !== manifest.totalPlaintextBytes ||
    totalCiphertextBytes !== manifest.totalCiphertextBytes
  ) {
    throw new Error(
      'Encrypted upload chunk sizes do not match manifest totals'
    );
  }
}

function defaultMapEncryptedCrdtOpToLocalOperation(
  input: MapEncryptedCrdtOpToLocalOperationInput
): QueueVfsCrdtLocalOperationInput {
  const { input: originalInput, encrypted } = input;
  return {
    opType: originalInput.opType,
    itemId: originalInput.itemId,
    encryptedPayload: encrypted.encryptedOp,
    keyEpoch: encrypted.keyEpoch,
    encryptionNonce: encrypted.opNonce,
    encryptionAad: encrypted.opAad,
    encryptionSignature: encrypted.opSignature
  };
}
