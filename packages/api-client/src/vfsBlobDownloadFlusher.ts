import type { UploadEncryptedBlobChunk } from './vfsCrypto/secureWritePipeline';
import type { EncryptedManifest } from './vfsCrypto/types';
import type { DownloadEncryptedBlobInput } from './vfsCrypto/secureReadPipeline';
import type { GetBlobManifestClientResponse } from './apiRoutes/vfsRoutes';
import type { GetBlobChunkClientResponse } from './apiRoutes/vfsRoutes';
import {
  defaultRetrySleep,
  emitTelemetryHook,
  getBlobOperationErrorInfo,
  isRetryableBlobOperationError,
  normalizeRetryPolicy
} from './vfsBlobNetworkFlusherRetry';
import type { VfsBlobNetworkRetryPolicy } from './vfsBlobNetworkFlusherTypes';
import type {
  VfsBlobDownloadFlusherPersistedState,
  VfsBlobDownloadLoadStateCallback,
  VfsBlobDownloadOperation,
  VfsBlobDownloadPersistStateCallback,
  VfsBlobDownloadResult,
  VfsBlobDownloadResultEvent,
  VfsBlobDownloadRetryPolicy
} from './vfsBlobDownloadTypes';

export type {
  VfsBlobDownloadFlusherPersistedState,
  VfsBlobDownloadLoadStateCallback,
  VfsBlobDownloadOperation,
  VfsBlobDownloadPersistStateCallback,
  VfsBlobDownloadResult,
  VfsBlobDownloadResultEvent,
  VfsBlobDownloadRetryPolicy
};

export interface VfsBlobDownloadFlusherOptions {
  getBlobManifest: (blobId: string) => Promise<GetBlobManifestClientResponse>;
  getBlobChunk: (
    blobId: string,
    chunkIndex: number
  ) => Promise<GetBlobChunkClientResponse>;
  decryptBlob: (input: DownloadEncryptedBlobInput) => Promise<Uint8Array>;
  storeLocal: (blobId: string, data: Uint8Array) => Promise<void>;
  existsLocal: (blobId: string) => Promise<boolean>;
  saveState?: VfsBlobDownloadPersistStateCallback;
  loadState?: VfsBlobDownloadLoadStateCallback;
  retryPolicy?: Partial<VfsBlobDownloadRetryPolicy>;
  onOperationResult?: (event: VfsBlobDownloadResultEvent) => void;
}

function toBase64(data: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < data.length; index += chunkSize) {
    binary += String.fromCharCode(...data.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export class VfsBlobDownloadFlusher {
  private readonly getBlobManifest: VfsBlobDownloadFlusherOptions['getBlobManifest'];
  private readonly getBlobChunk: VfsBlobDownloadFlusherOptions['getBlobChunk'];
  private readonly decryptBlob: VfsBlobDownloadFlusherOptions['decryptBlob'];
  private readonly storeLocal: VfsBlobDownloadFlusherOptions['storeLocal'];
  private readonly existsLocal: VfsBlobDownloadFlusherOptions['existsLocal'];
  private readonly saveState: VfsBlobDownloadPersistStateCallback | null;
  private readonly loadState: VfsBlobDownloadLoadStateCallback | null;
  private readonly retryPolicy: VfsBlobNetworkRetryPolicy;
  private readonly onOperationResult:
    | ((event: VfsBlobDownloadResultEvent) => void)
    | undefined;
  private readonly pendingDownloads: VfsBlobDownloadOperation[] = [];
  private flushPromise: Promise<VfsBlobDownloadResult> | null = null;

  constructor(options: VfsBlobDownloadFlusherOptions) {
    this.getBlobManifest = options.getBlobManifest;
    this.getBlobChunk = options.getBlobChunk;
    this.decryptBlob = options.decryptBlob;
    this.storeLocal = options.storeLocal;
    this.existsLocal = options.existsLocal;
    this.saveState = options.saveState ?? null;
    this.loadState = options.loadState ?? null;
    this.retryPolicy = normalizeRetryPolicy(options.retryPolicy);
    this.onOperationResult = options.onOperationResult;
  }

  queueDownloads(operations: VfsBlobDownloadOperation[]): void {
    const existingBlobIds = new Set(this.pendingDownloads.map((d) => d.blobId));
    for (const op of operations) {
      if (!existingBlobIds.has(op.blobId)) {
        this.pendingDownloads.push(op);
        existingBlobIds.add(op.blobId);
      }
    }
  }

  exportState(): VfsBlobDownloadFlusherPersistedState {
    return {
      pendingDownloads: [...this.pendingDownloads]
    };
  }

  hydrateState(state: VfsBlobDownloadFlusherPersistedState): void {
    this.pendingDownloads.length = 0;
    for (const op of state.pendingDownloads) {
      this.pendingDownloads.push(op);
    }
  }

  async hydrateFromPersistence(): Promise<boolean> {
    if (!this.loadState) {
      return false;
    }

    const state = await this.loadState();
    if (!state) {
      return false;
    }

    this.hydrateState(state);
    return true;
  }

  async persistState(): Promise<void> {
    if (!this.saveState) {
      return;
    }

    await this.saveState(this.exportState());
  }

  get pendingCount(): number {
    return this.pendingDownloads.length;
  }

  dequeueForItems(itemIds: Set<string>): void {
    for (let i = this.pendingDownloads.length - 1; i >= 0; i--) {
      const op = this.pendingDownloads[i];
      if (op && itemIds.has(op.itemId)) {
        this.pendingDownloads.splice(i, 1);
      }
    }
  }

  async flush(): Promise<VfsBlobDownloadResult> {
    if (this.flushPromise) {
      return this.flushPromise;
    }

    this.flushPromise = this.runFlush();
    try {
      return await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }

  private async runFlush(): Promise<VfsBlobDownloadResult> {
    let processedDownloads = 0;
    let skippedAlreadyCached = 0;

    while (this.pendingDownloads.length > 0) {
      const operation = this.pendingDownloads[0];
      if (!operation) {
        break;
      }

      const alreadyCached = await this.existsLocal(operation.blobId);
      if (alreadyCached) {
        this.pendingDownloads.shift();
        skippedAlreadyCached++;
        processedDownloads++;
        await emitTelemetryHook(this.onOperationResult, {
          operationId: operation.operationId,
          blobId: operation.blobId,
          success: true,
          skipped: true,
          attempts: 0
        });
        await this.persistState();
        continue;
      }

      const success = await this.executeWithRetry(operation);
      if (success) {
        this.pendingDownloads.shift();
        processedDownloads++;
        await this.persistState();
      } else {
        break;
      }
    }

    return {
      processedDownloads,
      pendingDownloads: this.pendingDownloads.length,
      skippedAlreadyCached
    };
  }

  private async executeWithRetry(
    operation: VfsBlobDownloadOperation
  ): Promise<boolean> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < this.retryPolicy.maxAttempts; attempt++) {
      try {
        await this.downloadAndStore(operation);
        await emitTelemetryHook(this.onOperationResult, {
          operationId: operation.operationId,
          blobId: operation.blobId,
          success: true,
          skipped: false,
          attempts: attempt + 1
        });
        return true;
      } catch (error) {
        lastError = error;

        if (!isRetryableBlobOperationError(error, this.retryPolicy)) {
          const info = getBlobOperationErrorInfo(error, this.retryPolicy);
          await emitTelemetryHook(this.onOperationResult, {
            operationId: operation.operationId,
            blobId: operation.blobId,
            success: false,
            skipped: false,
            attempts: attempt + 1,
            failureClass: info.failureClass,
            statusCode: info.statusCode
          });
          return false;
        }

        if (attempt < this.retryPolicy.maxAttempts - 1) {
          const delayMs = Math.min(
            this.retryPolicy.initialDelayMs *
              this.retryPolicy.backoffMultiplier ** attempt,
            this.retryPolicy.maxDelayMs
          );
          await defaultRetrySleep(delayMs);
        }
      }
    }

    const info = getBlobOperationErrorInfo(lastError, this.retryPolicy);
    await emitTelemetryHook(this.onOperationResult, {
      operationId: operation.operationId,
      blobId: operation.blobId,
      success: false,
      skipped: false,
      attempts: this.retryPolicy.maxAttempts,
      failureClass: info.failureClass,
      statusCode: info.statusCode
    });
    return false;
  }

  private async downloadAndStore(
    operation: VfsBlobDownloadOperation
  ): Promise<void> {
    const manifestResponse = await this.getBlobManifest(operation.blobId);

    const chunks: UploadEncryptedBlobChunk[] = [];
    for (
      let chunkIndex = 0;
      chunkIndex < manifestResponse.chunkCount;
      chunkIndex++
    ) {
      const chunkResponse = await this.getBlobChunk(
        operation.blobId,
        chunkIndex
      );
      chunks.push({
        chunkIndex: chunkResponse.chunkIndex,
        isFinal: chunkResponse.isFinal,
        nonce: chunkResponse.nonce,
        aadHash: chunkResponse.aadHash,
        ciphertextBase64: toBase64(chunkResponse.data),
        plaintextLength: chunkResponse.plaintextLength,
        ciphertextLength: chunkResponse.ciphertextLength
      });
    }

    const manifest: EncryptedManifest = {
      itemId: operation.itemId,
      blobId: operation.blobId,
      keyEpoch: manifestResponse.keyEpoch,
      contentType: manifestResponse.contentType,
      totalPlaintextBytes: manifestResponse.totalPlaintextBytes,
      totalCiphertextBytes: manifestResponse.totalCiphertextBytes,
      chunkCount: manifestResponse.chunkCount,
      chunkHashes: manifestResponse.chunkHashes,
      wrappedFileKeys: [],
      manifestSignature: manifestResponse.manifestSignature
    };

    const plaintext = await this.decryptBlob({ manifest, chunks });
    await this.storeLocal(operation.blobId, plaintext);
  }
}

export function createVfsBlobDownloadFlusher(
  options: VfsBlobDownloadFlusherOptions
): VfsBlobDownloadFlusher {
  return new VfsBlobDownloadFlusher(options);
}
