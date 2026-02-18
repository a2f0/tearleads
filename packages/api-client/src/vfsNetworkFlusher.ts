import {
  type QueueVfsCrdtLocalOperationInput,
  VfsBackgroundSyncClient,
  type VfsBackgroundSyncClientFlushResult,
  type VfsBackgroundSyncClientOptions,
  type VfsBackgroundSyncClientPersistedState,
  type VfsBackgroundSyncClientSnapshot,
  type VfsBackgroundSyncClientSyncResult,
  type VfsCrdtOperation,
  type VfsCrdtSyncTransport,
  VfsHttpCrdtSyncTransport,
  type VfsHttpCrdtSyncTransportOptions,
  type VfsSyncCursor
} from '@tearleads/vfs-sync/vfs';
import { fetchWithAuthRefresh } from './vfsAuthFetch';

export interface VfsApiCrdtTransportOptions
  extends Omit<VfsHttpCrdtSyncTransportOptions, 'fetchImpl' | 'getAuthToken'> {}

export function createVfsApiCrdtTransport(
  options: VfsApiCrdtTransportOptions = {}
): VfsCrdtSyncTransport {
  return new VfsHttpCrdtSyncTransport({
    ...options,
    fetchImpl: (input, init) => fetchWithAuthRefresh(fetch, input, init)
  });
}

type PersistStateCallback = (
  state: VfsBackgroundSyncClientPersistedState
) => Promise<void> | void;

type LoadStateCallback = () =>
  | Promise<VfsBackgroundSyncClientPersistedState | null>
  | VfsBackgroundSyncClientPersistedState
  | null;

export interface VfsApiNetworkFlusherOptions
  extends VfsBackgroundSyncClientOptions {
  transport?: VfsCrdtSyncTransport;
  transportOptions?: VfsApiCrdtTransportOptions;
  saveState?: PersistStateCallback;
  loadState?: LoadStateCallback;
}

export class VfsApiNetworkFlusher {
  private readonly client: VfsBackgroundSyncClient;
  private readonly saveState: PersistStateCallback | null;
  private readonly loadState: LoadStateCallback | null;

  constructor(
    userId: string,
    clientId: string,
    options: VfsApiNetworkFlusherOptions = {}
  ) {
    this.client = new VfsBackgroundSyncClient(
      userId,
      clientId,
      options.transport ??
        createVfsApiCrdtTransport(options.transportOptions ?? {}),
      {
        pullLimit: options.pullLimit,
        now: options.now,
        onBackgroundError: options.onBackgroundError,
        onGuardrailViolation: options.onGuardrailViolation
      }
    );
    this.saveState = options.saveState ?? null;
    this.loadState = options.loadState ?? null;
  }

  async hydrateFromPersistence(): Promise<boolean> {
    if (!this.loadState) {
      return false;
    }

    const state = await this.loadState();
    if (state === null) {
      return false;
    }

    this.client.hydrateState(state);
    return true;
  }

  async persistState(): Promise<void> {
    if (!this.saveState) {
      return;
    }

    await this.saveState(this.client.exportState());
  }

  queueLocalOperation(
    input: QueueVfsCrdtLocalOperationInput
  ): VfsCrdtOperation {
    return this.client.queueLocalOperation(input);
  }

  async queueLocalOperationAndPersist(
    input: QueueVfsCrdtLocalOperationInput
  ): Promise<VfsCrdtOperation> {
    const operation = this.client.queueLocalOperation(input);
    await this.persistState();
    return operation;
  }

  queuedOperations(): VfsCrdtOperation[] {
    return this.client.queuedOperations();
  }

  snapshot(): VfsBackgroundSyncClientSnapshot {
    return this.client.snapshot();
  }

  exportState(): VfsBackgroundSyncClientPersistedState {
    return this.client.exportState();
  }

  hydrateState(state: VfsBackgroundSyncClientPersistedState): void {
    this.client.hydrateState(state);
  }

  listChangedContainers(
    cursor: VfsSyncCursor | null,
    limit?: number
  ): ReturnType<VfsBackgroundSyncClient['listChangedContainers']> {
    return this.client.listChangedContainers(cursor, limit);
  }

  async flush(): Promise<VfsBackgroundSyncClientFlushResult> {
    const result = await this.client.flush();
    await this.persistState();
    return result;
  }

  async sync(): Promise<VfsBackgroundSyncClientSyncResult> {
    const result = await this.client.sync();
    await this.persistState();
    return result;
  }

  startBackgroundFlush(intervalMs: number): void {
    this.client.startBackgroundFlush(intervalMs);
  }

  async stopBackgroundFlush(waitForInFlightFlush = true): Promise<void> {
    await this.client.stopBackgroundFlush(waitForInFlightFlush);
    await this.persistState();
  }
}
