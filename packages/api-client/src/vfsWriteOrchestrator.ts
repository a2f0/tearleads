import {
  type LocalWriteOperation,
  type LocalWriteOptions,
  LocalWriteOrchestrator
} from '@tearleads/local-write-orchestrator';
import type {
  QueueVfsCrdtLocalOperationInput,
  VfsBackgroundSyncClientFlushResult,
  VfsBackgroundSyncClientPersistedState,
  VfsBackgroundSyncClientSyncResult,
  VfsCrdtOperation
} from '@tearleads/vfs-sync/vfs';
import {
  type VfsBlobAbandonQueueOperation,
  type VfsBlobAbandonRequest,
  type VfsBlobAttachQueueOperation,
  type VfsBlobAttachRequest,
  type VfsBlobChunkQueueOperation,
  type VfsBlobChunkUploadRequest,
  type VfsBlobCommitQueueOperation,
  type VfsBlobManifestCommitRequest,
  VfsBlobNetworkFlusher,
  type VfsBlobNetworkFlusherFlushResult,
  type VfsBlobNetworkFlusherOptions,
  type VfsBlobNetworkFlusherPersistedState,
  type VfsBlobNetworkOperation,
  type VfsBlobStageQueueOperation,
  type VfsBlobStageRequest
} from './vfsBlobNetworkFlusher';
import {
  createVfsSecureOrchestratorFacadeWithRuntime,
  type VfsSecureOrchestratorFacadeOptions
} from './vfsCrypto/secureOrchestratorFacade';
import type { VfsSecureOrchestratorFacade } from './vfsCrypto/secureWritePipeline';
import type { VfsSecureWritePipelineRuntimeOptions } from './vfsCrypto/secureWritePipelineRuntime';
import {
  VfsApiNetworkFlusher,
  type VfsApiNetworkFlusherOptions
} from './vfsNetworkFlusher';
import {
  PassthroughVfsSecureWritePipeline,
  type VfsSecureWritePipeline
} from './vfsSecureWritePipeline';

export interface VfsWriteOrchestratorPersistedState {
  crdt: VfsBackgroundSyncClientPersistedState | null;
  blob: VfsBlobNetworkFlusherPersistedState | null;
}

type PersistStateCallback = (
  state: VfsWriteOrchestratorPersistedState
) => Promise<void> | void;

type LoadStateCallback = () =>
  | Promise<VfsWriteOrchestratorPersistedState | null>
  | VfsWriteOrchestratorPersistedState
  | null;

type CrdtFlusherOptionsWithoutPersistence = Omit<
  VfsApiNetworkFlusherOptions,
  'saveState' | 'loadState'
>;

type BlobFlusherOptionsWithoutPersistence = Omit<
  VfsBlobNetworkFlusherOptions,
  'saveState' | 'loadState'
>;

export interface VfsWriteOrchestratorOptions {
  crdt?: CrdtFlusherOptionsWithoutPersistence;
  blob?: BlobFlusherOptionsWithoutPersistence;
  saveState?: PersistStateCallback;
  loadState?: LoadStateCallback;
  localWriteQueue?: LocalWriteQueue;
  loadStateWriteOptions?: LocalWriteOptions;
  saveStateWriteOptions?: LocalWriteOptions;
  secureWritePipeline?: VfsSecureWritePipeline;
}

export interface VfsWriteOrchestratorFlushResult {
  crdt: VfsBackgroundSyncClientFlushResult;
  blob: VfsBlobNetworkFlusherFlushResult;
}

class VfsWriteOrchestratorImpl {
  readonly crdt: VfsApiNetworkFlusher;
  readonly blob: VfsBlobNetworkFlusher;
  private readonly saveStateCallback: PersistStateCallback | null;
  private readonly loadStateCallback: LoadStateCallback | null;
  private readonly localWriteQueue: LocalWriteQueue;
  private readonly loadStateWriteOptions: LocalWriteOptions | undefined;
  private readonly saveStateWriteOptions: LocalWriteOptions | undefined;
  private readonly secureWritePipeline: VfsSecureWritePipeline;
  private inFlightSyncCrdt: Promise<VfsBackgroundSyncClientSyncResult> | null =
    null;
  private inFlightFlushAll: Promise<VfsWriteOrchestratorFlushResult> | null =
    null;
  private protocolQueueTail: Promise<void> = Promise.resolve();

  constructor(
    userId: string,
    clientId: string,
    options: VfsWriteOrchestratorOptions = {}
  ) {
    this.crdt = new VfsApiNetworkFlusher(userId, clientId, options.crdt);
    this.blob = new VfsBlobNetworkFlusher(options.blob);
    this.saveStateCallback = options.saveState ?? null;
    this.loadStateCallback = options.loadState ?? null;
    this.localWriteQueue =
      options.localWriteQueue ?? new LocalWriteOrchestrator();
    this.loadStateWriteOptions = options.loadStateWriteOptions;
    this.saveStateWriteOptions = options.saveStateWriteOptions;
    this.secureWritePipeline =
      options.secureWritePipeline ?? new PassthroughVfsSecureWritePipeline();
  }

  exportState(): VfsWriteOrchestratorPersistedState {
    return {
      crdt: this.crdt.exportState(),
      blob: this.blob.exportState()
    };
  }

  hydrateState(state: VfsWriteOrchestratorPersistedState): void {
    if (typeof state !== 'object' || state === null) {
      throw new Error('state must be a non-null object');
    }

    if (state.crdt !== null) {
      this.crdt.hydrateState(state.crdt);
    }
    if (state.blob !== null) {
      this.blob.hydrateState(state.blob);
    }
  }

  async hydrateFromPersistence(): Promise<boolean> {
    if (!this.loadStateCallback) {
      return false;
    }

    const state = await this.enqueueLocalWrite(
      async () => this.loadStateCallback?.() ?? null,
      this.loadStateWriteOptions
    );
    if (state === null) {
      return false;
    }

    this.hydrateState(state);
    return true;
  }

  async persistState(): Promise<void> {
    if (!this.saveStateCallback) {
      return;
    }

    await this.enqueueLocalWrite(
      async () => this.saveStateCallback?.(this.exportState()),
      this.saveStateWriteOptions
    );
  }

  queueCrdtLocalOperation(
    input: QueueVfsCrdtLocalOperationInput
  ): VfsCrdtOperation {
    return this.crdt.queueLocalOperation(input);
  }

  async queueCrdtLocalOperationAndPersist(
    input: QueueVfsCrdtLocalOperationInput
  ): Promise<VfsCrdtOperation> {
    const operation = this.crdt.queueLocalOperation(input);
    await this.persistState();
    return operation;
  }

  async queueCrdtLocalOperationSecureAndPersist(
    input: QueueVfsCrdtLocalOperationInput
  ): Promise<VfsCrdtOperation> {
    const preparedInput =
      await this.secureWritePipeline.prepareCrdtLocalOperation(input);
    return this.queueCrdtLocalOperationAndPersist(preparedInput);
  }

  queuedCrdtOperations(): VfsCrdtOperation[] {
    return this.crdt.queuedOperations();
  }

  queueBlobStage(input: VfsBlobStageRequest): VfsBlobStageQueueOperation {
    return this.blob.queueStage(input);
  }

  async queueBlobStageAndPersist(
    input: VfsBlobStageRequest
  ): Promise<VfsBlobStageQueueOperation> {
    const operation = this.blob.queueStage(input);
    await this.persistState();
    return operation;
  }

  async queueBlobStageSecureAndPersist(
    input: VfsBlobStageRequest
  ): Promise<VfsBlobStageQueueOperation> {
    const preparedInput =
      await this.secureWritePipeline.prepareBlobStage(input);
    return this.queueBlobStageAndPersist(preparedInput);
  }

  queueBlobAttach(input: VfsBlobAttachRequest): VfsBlobAttachQueueOperation {
    return this.blob.queueAttach(input);
  }

  async queueBlobAttachAndPersist(
    input: VfsBlobAttachRequest
  ): Promise<VfsBlobAttachQueueOperation> {
    const operation = this.blob.queueAttach(input);
    await this.persistState();
    return operation;
  }

  queueBlobAbandon(input: VfsBlobAbandonRequest): VfsBlobAbandonQueueOperation {
    return this.blob.queueAbandon(input);
  }

  async queueBlobAbandonAndPersist(
    input: VfsBlobAbandonRequest
  ): Promise<VfsBlobAbandonQueueOperation> {
    const operation = this.blob.queueAbandon(input);
    await this.persistState();
    return operation;
  }

  queueBlobChunk(input: VfsBlobChunkUploadRequest): VfsBlobChunkQueueOperation {
    return this.blob.queueChunk(input);
  }

  async queueBlobChunkAndPersist(
    input: VfsBlobChunkUploadRequest
  ): Promise<VfsBlobChunkQueueOperation> {
    const operation = this.blob.queueChunk(input);
    await this.persistState();
    return operation;
  }

  queueBlobManifestCommit(
    input: VfsBlobManifestCommitRequest
  ): VfsBlobCommitQueueOperation {
    return this.blob.queueManifestCommit(input);
  }

  async queueBlobManifestCommitAndPersist(
    input: VfsBlobManifestCommitRequest
  ): Promise<VfsBlobCommitQueueOperation> {
    const operation = this.blob.queueManifestCommit(input);
    await this.persistState();
    return operation;
  }

  queuedBlobOperations(): VfsBlobNetworkOperation[] {
    return this.blob.queuedOperations();
  }

  createSecureOrchestratorFacadeWithRuntime(
    runtimeOptions: VfsSecureWritePipelineRuntimeOptions,
    options: VfsSecureOrchestratorFacadeOptions = {}
  ): VfsSecureOrchestratorFacade {
    return createVfsSecureOrchestratorFacadeWithRuntime(
      this,
      runtimeOptions,
      options
    );
  }

  async syncCrdt(): Promise<VfsBackgroundSyncClientSyncResult> {
    if (this.inFlightSyncCrdt) {
      return this.inFlightSyncCrdt;
    }

    this.inFlightSyncCrdt = this.enqueueProtocolRun(async () => {
      const result = await this.crdt.sync();
      await this.persistState();
      return result;
    });

    try {
      return await this.inFlightSyncCrdt;
    } finally {
      this.inFlightSyncCrdt = null;
    }
  }

  async flushAll(): Promise<VfsWriteOrchestratorFlushResult> {
    if (this.inFlightFlushAll) {
      return this.inFlightFlushAll;
    }

    this.inFlightFlushAll = this.enqueueProtocolRun(async () => {
      try {
        const [crdtResult, blobResult] = await Promise.all([
          this.crdt.flush(),
          this.blob.flush()
        ]);
        return {
          crdt: crdtResult,
          blob: blobResult
        };
      } finally {
        await this.persistState();
      }
    });

    try {
      return await this.inFlightFlushAll;
    } finally {
      this.inFlightFlushAll = null;
    }
  }

  private async enqueueLocalWrite<T>(
    operation: () => Promise<T> | T,
    options: LocalWriteOptions | undefined
  ): Promise<T> {
    return this.localWriteQueue.enqueue(
      async (): Promise<T> => operation(),
      options
    );
  }

  private async enqueueProtocolRun<T>(run: () => Promise<T>): Promise<T> {
    const scheduledRun = this.protocolQueueTail.then(run);
    this.protocolQueueTail = scheduledRun.then(
      () => undefined,
      () => undefined
    );
    return scheduledRun;
  }
}

export type VfsWriteOrchestrator = VfsWriteOrchestratorImpl;
export const VfsWriteOrchestrator = VfsWriteOrchestratorImpl;

export interface LocalWriteQueue {
  enqueue<T>(
    operation: LocalWriteOperation<T>,
    options?: LocalWriteOptions
  ): Promise<T>;
}
