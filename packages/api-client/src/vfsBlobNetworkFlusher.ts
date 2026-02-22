import {
  cloneOperation,
  cloneOperations,
  createOperationId,
  normalizeApiPrefix,
  normalizeAttachConsistency,
  normalizeBaseUrl,
  normalizeIsoTimestamp,
  normalizeRequiredString,
  normalizeStageEncryptionMetadata
} from './vfsBlobNetworkFlusherHelpers';
import {
  defaultRetrySleep,
  emitTelemetryHook,
  getBlobOperationErrorInfo,
  isRetryableBlobOperationError,
  normalizeRetryPolicy
} from './vfsBlobNetworkFlusherRetry';
import type {
  LoadStateCallback,
  PersistStateCallback,
  VfsBlobAbandonQueueOperation,
  VfsBlobAbandonRequest,
  VfsBlobAttachQueueOperation,
  VfsBlobAttachRequest,
  VfsBlobChunkQueueOperation,
  VfsBlobChunkUploadRequest,
  VfsBlobCommitQueueOperation,
  VfsBlobManifestCommitRequest,
  VfsBlobNetworkFlusherFlushResult,
  VfsBlobNetworkFlusherOptions,
  VfsBlobNetworkFlusherPersistedState,
  VfsBlobNetworkOperation,
  VfsBlobNetworkOperationResultEvent,
  VfsBlobNetworkRetryEvent,
  VfsBlobNetworkRetryPolicy,
  VfsBlobStageQueueOperation,
  VfsBlobStageRequest
} from './vfsBlobNetworkFlusherTypes';
import {
  executeBlobNetworkOperation,
  isManifestCommitSizeShapeValid,
  normalizeBlobNetworkOperation
} from './vfsBlobNetworkOperationRuntime';

export type {
  VfsBlobAbandonQueueOperation,
  VfsBlobAbandonRequest,
  VfsBlobAbandonResponse,
  VfsBlobAttachConsistency,
  VfsBlobAttachQueueOperation,
  VfsBlobAttachRequest,
  VfsBlobAttachResponse,
  VfsBlobChunkQueueOperation,
  VfsBlobChunkUploadRequest,
  VfsBlobCommitQueueOperation,
  VfsBlobManifestCommitRequest,
  VfsBlobNetworkFlusherFlushResult,
  VfsBlobNetworkFlusherOptions,
  VfsBlobNetworkFlusherPersistedState,
  VfsBlobNetworkOperation,
  VfsBlobNetworkOperationResultEvent,
  VfsBlobNetworkRetryEvent,
  VfsBlobNetworkRetryPolicy,
  VfsBlobRelationKind,
  VfsBlobStageQueueOperation,
  VfsBlobStageRequest,
  VfsBlobStageResponse
} from './vfsBlobNetworkFlusherTypes';

export class VfsBlobNetworkFlusher {
  private readonly baseUrl: string;
  private readonly apiPrefix: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly saveState: PersistStateCallback | null;
  private readonly loadState: LoadStateCallback | null;
  private readonly retryPolicy: VfsBlobNetworkRetryPolicy;
  private readonly retrySleep: (delayMs: number) => Promise<void>;
  private readonly onRetry:
    | ((event: VfsBlobNetworkRetryEvent) => Promise<void> | void)
    | undefined;
  private readonly onOperationResult:
    | ((event: VfsBlobNetworkOperationResultEvent) => Promise<void> | void)
    | undefined;
  private readonly pendingOperations: VfsBlobNetworkOperation[] = [];
  private flushPromise: Promise<VfsBlobNetworkFlusherFlushResult> | null = null;

  constructor(options: VfsBlobNetworkFlusherOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? '');
    this.apiPrefix = normalizeApiPrefix(options.apiPrefix ?? '/v1');
    this.headers = options.headers ?? {};
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.saveState = options.saveState ?? null;
    this.loadState = options.loadState ?? null;
    this.retryPolicy = normalizeRetryPolicy(options.retryPolicy);
    this.onRetry = options.onRetry;
    this.onOperationResult = options.onOperationResult;
    this.retrySleep = async (delayMs) => {
      await Promise.resolve(options.retrySleep?.(delayMs));
      if (!options.retrySleep) {
        await defaultRetrySleep(delayMs);
      }
    };
  }

  queuedOperations(): VfsBlobNetworkOperation[] {
    return cloneOperations(this.pendingOperations);
  }

  exportState(): VfsBlobNetworkFlusherPersistedState {
    return {
      pendingOperations: this.queuedOperations()
    };
  }

  hydrateState(state: VfsBlobNetworkFlusherPersistedState): void {
    if (!state || !Array.isArray(state.pendingOperations)) {
      throw new Error('state.pendingOperations must be an array');
    }

    if (this.flushPromise) {
      throw new Error('cannot hydrate state while flush is in progress');
    }

    const normalized: VfsBlobNetworkOperation[] = [];
    for (const operation of state.pendingOperations) {
      normalized.push(normalizeBlobNetworkOperation(operation));
    }

    this.pendingOperations.length = 0;
    this.pendingOperations.push(...normalized);
  }

  async hydrateFromPersistence(): Promise<boolean> {
    if (!this.loadState) {
      return false;
    }

    const state = await this.loadState();
    if (state === null) {
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

  queueStage(input: VfsBlobStageRequest): VfsBlobStageQueueOperation {
    const blobId = normalizeRequiredString(input.blobId);
    if (!blobId) {
      throw new Error('blobId is required');
    }

    const expiresAt = normalizeIsoTimestamp(input.expiresAt);
    if (!expiresAt) {
      throw new Error('expiresAt must be a valid ISO timestamp');
    }

    const stagingId =
      normalizeRequiredString(input.stagingId) ??
      `stage-${createOperationId()}`;
    const operation: VfsBlobStageQueueOperation = {
      operationId: createOperationId(),
      kind: 'stage',
      payload: {
        stagingId,
        blobId,
        expiresAt,
        encryption: normalizeStageEncryptionMetadata(input.encryption)
      }
    };

    const normalized = normalizeBlobNetworkOperation(operation);
    this.pendingOperations.push(normalized);
    return cloneOperation(normalized);
  }

  async queueStageAndPersist(
    input: VfsBlobStageRequest
  ): Promise<VfsBlobStageQueueOperation> {
    const operation = this.queueStage(input);
    await this.persistState();
    return operation;
  }

  queueAttach(input: VfsBlobAttachRequest): VfsBlobAttachQueueOperation {
    const stagingId = normalizeRequiredString(input.stagingId);
    if (!stagingId) {
      throw new Error('stagingId is required');
    }

    const itemId = normalizeRequiredString(input.itemId);
    if (!itemId) {
      throw new Error('itemId is required');
    }

    const operation: VfsBlobAttachQueueOperation = {
      operationId: createOperationId(),
      kind: 'attach',
      payload: {
        stagingId,
        itemId,
        relationKind: input.relationKind ?? 'file',
        consistency: normalizeAttachConsistency(input.consistency)
      }
    };

    const normalized = normalizeBlobNetworkOperation(operation);
    this.pendingOperations.push(normalized);
    return cloneOperation(normalized);
  }

  async queueAttachAndPersist(
    input: VfsBlobAttachRequest
  ): Promise<VfsBlobAttachQueueOperation> {
    const operation = this.queueAttach(input);
    await this.persistState();
    return operation;
  }

  queueAbandon(input: VfsBlobAbandonRequest): VfsBlobAbandonQueueOperation {
    const stagingId = normalizeRequiredString(input.stagingId);
    if (!stagingId) {
      throw new Error('stagingId is required');
    }

    const operation: VfsBlobAbandonQueueOperation = {
      operationId: createOperationId(),
      kind: 'abandon',
      payload: { stagingId }
    };
    this.pendingOperations.push(operation);
    return cloneOperation(operation);
  }

  async queueAbandonAndPersist(
    input: VfsBlobAbandonRequest
  ): Promise<VfsBlobAbandonQueueOperation> {
    const operation = this.queueAbandon(input);
    await this.persistState();
    return operation;
  }

  queueChunk(input: VfsBlobChunkUploadRequest): VfsBlobChunkQueueOperation {
    const stagingId = normalizeRequiredString(input.stagingId);
    const uploadId = normalizeRequiredString(input.uploadId);
    const nonce = normalizeRequiredString(input.nonce);
    const aadHash = normalizeRequiredString(input.aadHash);
    const ciphertextBase64 = normalizeRequiredString(input.ciphertextBase64);
    if (
      !stagingId ||
      !uploadId ||
      !nonce ||
      !aadHash ||
      !ciphertextBase64 ||
      !Number.isInteger(input.chunkIndex) ||
      input.chunkIndex < 0 ||
      !Number.isInteger(input.plaintextLength) ||
      input.plaintextLength < 0 ||
      !Number.isInteger(input.ciphertextLength) ||
      input.ciphertextLength < 0
    ) {
      throw new Error('chunk payload is invalid');
    }

    const operation: VfsBlobChunkQueueOperation = {
      operationId: createOperationId(),
      kind: 'chunk',
      payload: {
        stagingId,
        uploadId,
        chunkIndex: input.chunkIndex,
        isFinal: input.isFinal,
        nonce,
        aadHash,
        ciphertextBase64,
        plaintextLength: input.plaintextLength,
        ciphertextLength: input.ciphertextLength
      }
    };

    const normalized = normalizeBlobNetworkOperation(operation);
    this.pendingOperations.push(normalized);
    return cloneOperation(normalized);
  }

  async queueChunkAndPersist(
    input: VfsBlobChunkUploadRequest
  ): Promise<VfsBlobChunkQueueOperation> {
    const operation = this.queueChunk(input);
    await this.persistState();
    return operation;
  }

  queueManifestCommit(
    input: VfsBlobManifestCommitRequest
  ): VfsBlobCommitQueueOperation {
    const stagingId = normalizeRequiredString(input.stagingId);
    const uploadId = normalizeRequiredString(input.uploadId);
    const manifestHash = normalizeRequiredString(input.manifestHash);
    const manifestSignature = normalizeRequiredString(input.manifestSignature);
    if (
      !stagingId ||
      !uploadId ||
      !manifestHash ||
      !manifestSignature ||
      !Number.isInteger(input.keyEpoch) ||
      input.keyEpoch <= 0 ||
      !Number.isInteger(input.chunkCount) ||
      input.chunkCount < 0 ||
      !Number.isInteger(input.totalPlaintextBytes) ||
      input.totalPlaintextBytes < 0 ||
      !Number.isInteger(input.totalCiphertextBytes) ||
      input.totalCiphertextBytes < 0
    ) {
      throw new Error('manifest commit payload is invalid');
    }
    if (
      !isManifestCommitSizeShapeValid(
        input.chunkCount,
        input.totalPlaintextBytes,
        input.totalCiphertextBytes
      )
    ) {
      throw new Error('manifest commit payload is invalid');
    }

    const operation: VfsBlobCommitQueueOperation = {
      operationId: createOperationId(),
      kind: 'commit',
      payload: {
        stagingId,
        uploadId,
        keyEpoch: input.keyEpoch,
        manifestHash,
        manifestSignature,
        chunkCount: input.chunkCount,
        totalPlaintextBytes: input.totalPlaintextBytes,
        totalCiphertextBytes: input.totalCiphertextBytes
      }
    };

    const normalized = normalizeBlobNetworkOperation(operation);
    this.pendingOperations.push(normalized);
    return cloneOperation(normalized);
  }

  async queueManifestCommitAndPersist(
    input: VfsBlobManifestCommitRequest
  ): Promise<VfsBlobCommitQueueOperation> {
    const operation = this.queueManifestCommit(input);
    await this.persistState();
    return operation;
  }

  async flush(): Promise<VfsBlobNetworkFlusherFlushResult> {
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

  private async runFlush(): Promise<VfsBlobNetworkFlusherFlushResult> {
    let processedOperations = 0;

    try {
      while (processedOperations < this.pendingOperations.length) {
        const operation = this.pendingOperations[processedOperations];
        if (!operation) {
          break;
        }

        await this.executeOperationWithRetry(operation);
        processedOperations += 1;
        await this.persistPendingFromOffset(processedOperations);
      }
    } finally {
      if (processedOperations > 0) {
        this.pendingOperations.splice(0, processedOperations);
      }
    }

    return {
      processedOperations,
      pendingOperations: this.pendingOperations.length
    };
  }

  private async persistPendingFromOffset(offset: number): Promise<void> {
    if (!this.saveState) {
      return;
    }

    await this.saveState({
      pendingOperations: cloneOperations(this.pendingOperations.slice(offset))
    });
  }

  private async executeOperationWithRetry(
    operation: VfsBlobNetworkOperation
  ): Promise<void> {
    let attempt = 1;
    let delayMs = this.retryPolicy.initialDelayMs;

    // Retry only transient failures and keep retries bounded.
    while (true) {
      try {
        await executeBlobNetworkOperation(
          {
            baseUrl: this.baseUrl,
            apiPrefix: this.apiPrefix,
            headers: this.headers,
            fetchImpl: this.fetchImpl
          },
          operation
        );
        await emitTelemetryHook(this.onOperationResult, {
          operationId: operation.operationId,
          operationKind: operation.kind,
          attempts: attempt,
          retryCount: Math.max(0, attempt - 1),
          success: true
        });
        return;
      } catch (error) {
        const errorInfo = getBlobOperationErrorInfo(error, this.retryPolicy);
        const canRetry =
          attempt < this.retryPolicy.maxAttempts &&
          isRetryableBlobOperationError(error, this.retryPolicy);
        if (!canRetry) {
          await emitTelemetryHook(this.onOperationResult, {
            operationId: operation.operationId,
            operationKind: operation.kind,
            attempts: attempt,
            retryCount: Math.max(0, attempt - 1),
            success: false,
            failureClass: errorInfo.failureClass,
            statusCode: errorInfo.statusCode,
            retryable: errorInfo.retryable
          });
          throw error;
        }

        await emitTelemetryHook(this.onRetry, {
          operationId: operation.operationId,
          operationKind: operation.kind,
          attempt,
          maxAttempts: this.retryPolicy.maxAttempts,
          delayMs,
          failureClass: errorInfo.failureClass,
          statusCode: errorInfo.statusCode
        });
      }

      await this.retrySleep(delayMs);
      delayMs = Math.min(
        this.retryPolicy.maxDelayMs,
        Math.max(1, Math.round(delayMs * this.retryPolicy.backoffMultiplier))
      );
      attempt += 1;
    }
  }
}
