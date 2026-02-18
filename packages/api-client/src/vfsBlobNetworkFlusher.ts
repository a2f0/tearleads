import { encodeVfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import {
  cloneOperation,
  cloneOperations,
  createOperationId,
  fetchWithAuthRefresh,
  isBlobRelationKind,
  normalizeApiPrefix,
  normalizeAttachConsistency,
  normalizeBaseUrl,
  normalizeIsoTimestamp,
  normalizeRequiredString,
  parseErrorMessage
} from './vfsBlobNetworkFlusherHelpers';
import type {
  LoadStateCallback,
  PersistStateCallback,
  VfsBlobAbandonQueueOperation,
  VfsBlobAbandonRequest,
  VfsBlobAttachQueueOperation,
  VfsBlobAttachRequest,
  VfsBlobNetworkFlusherFlushResult,
  VfsBlobNetworkFlusherOptions,
  VfsBlobNetworkFlusherPersistedState,
  VfsBlobNetworkOperation,
  VfsBlobStageQueueOperation,
  VfsBlobStageRequest
} from './vfsBlobNetworkFlusherTypes';

export type {
  VfsBlobAbandonQueueOperation,
  VfsBlobAbandonRequest,
  VfsBlobAbandonResponse,
  VfsBlobAttachConsistency,
  VfsBlobAttachQueueOperation,
  VfsBlobAttachRequest,
  VfsBlobAttachResponse,
  VfsBlobNetworkFlusherFlushResult,
  VfsBlobNetworkFlusherOptions,
  VfsBlobNetworkFlusherPersistedState,
  VfsBlobNetworkOperation,
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
  private readonly pendingOperations: VfsBlobNetworkOperation[] = [];
  private flushPromise: Promise<VfsBlobNetworkFlusherFlushResult> | null = null;

  constructor(options: VfsBlobNetworkFlusherOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? '');
    this.apiPrefix = normalizeApiPrefix(options.apiPrefix ?? '/v1');
    this.headers = options.headers ?? {};
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.saveState = options.saveState ?? null;
    this.loadState = options.loadState ?? null;
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
      normalized.push(this.normalizeQueueOperation(operation));
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
        expiresAt
      }
    };
    this.pendingOperations.push(operation);
    return cloneOperation(operation);
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

    const relationKind = input.relationKind ?? 'file';
    if (!isBlobRelationKind(relationKind)) {
      throw new Error('relationKind is invalid');
    }

    const consistency = normalizeAttachConsistency(input.consistency);
    const operation: VfsBlobAttachQueueOperation = {
      operationId: createOperationId(),
      kind: 'attach',
      payload: {
        stagingId,
        itemId,
        relationKind,
        consistency
      }
    };
    this.pendingOperations.push(operation);
    return cloneOperation(operation);
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

    while (this.pendingOperations.length > 0) {
      const operation = this.pendingOperations[0];
      if (!operation) {
        break;
      }

      await this.executeOperation(operation);
      this.pendingOperations.shift();
      processedOperations += 1;
      await this.persistState();
    }

    return {
      processedOperations,
      pendingOperations: this.pendingOperations.length
    };
  }

  private async executeOperation(
    operation: VfsBlobNetworkOperation
  ): Promise<void> {
    if (operation.kind === 'stage') {
      await this.requestJson('/vfs/blobs/stage', {
        stagingId: operation.payload.stagingId,
        blobId: operation.payload.blobId,
        expiresAt: operation.payload.expiresAt
      });
      return;
    }

    if (operation.kind === 'attach') {
      const body: Record<string, unknown> = {
        itemId: operation.payload.itemId,
        relationKind: operation.payload.relationKind
      };
      if (operation.payload.consistency) {
        body['clientId'] = operation.payload.consistency.clientId;
        body['requiredCursor'] = encodeVfsSyncCursor(
          operation.payload.consistency.requiredCursor
        );
        body['requiredLastReconciledWriteIds'] = {
          ...operation.payload.consistency.requiredLastReconciledWriteIds
        };
      }

      await this.requestJson(
        `/vfs/blobs/stage/${encodeURIComponent(operation.payload.stagingId)}/attach`,
        body
      );
      return;
    }

    await this.requestJson(
      `/vfs/blobs/stage/${encodeURIComponent(operation.payload.stagingId)}/abandon`,
      {}
    );
  }

  private async requestJson(path: string, body: unknown): Promise<unknown> {
    const url = this.buildUrl(path);
    const headers = new Headers();
    headers.set('Accept', 'application/json');
    headers.set('Content-Type', 'application/json');
    for (const [header, value] of Object.entries(this.headers)) {
      headers.set(header, value);
    }

    const response = await fetchWithAuthRefresh(this.fetchImpl, url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    const rawBody = await response.text();
    const parsedBody = this.parseBody(rawBody);

    if (!response.ok) {
      throw new Error(
        parseErrorMessage(parsedBody, `API error: ${response.status}`)
      );
    }

    return parsedBody;
  }

  private parseBody(rawBody: string): unknown {
    if (rawBody.length === 0) {
      return null;
    }

    try {
      return JSON.parse(rawBody);
    } catch {
      throw new Error('transport returned non-JSON response');
    }
  }

  private buildUrl(path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const pathname = `${this.apiPrefix}${normalizedPath}`;
    return this.baseUrl.length > 0 ? `${this.baseUrl}${pathname}` : pathname;
  }

  private normalizeQueueOperation(
    operation: VfsBlobNetworkOperation
  ): VfsBlobNetworkOperation {
    if (!operation || typeof operation !== 'object') {
      throw new Error('operation is invalid');
    }

    const operationId = normalizeRequiredString(operation.operationId);
    if (!operationId) {
      throw new Error('operation.operationId is required');
    }

    if (operation.kind === 'stage') {
      const stagingId = normalizeRequiredString(operation.payload.stagingId);
      const blobId = normalizeRequiredString(operation.payload.blobId);
      const expiresAt = normalizeIsoTimestamp(operation.payload.expiresAt);
      if (!stagingId || !blobId || !expiresAt) {
        throw new Error('stage operation payload is invalid');
      }

      return {
        operationId,
        kind: 'stage',
        payload: {
          stagingId,
          blobId,
          expiresAt
        }
      };
    }

    if (operation.kind === 'abandon') {
      const stagingId = normalizeRequiredString(operation.payload.stagingId);
      if (!stagingId) {
        throw new Error('abandon operation payload is invalid');
      }

      return {
        operationId,
        kind: 'abandon',
        payload: {
          stagingId
        }
      };
    }

    if (operation.kind === 'attach') {
      const stagingId = normalizeRequiredString(operation.payload.stagingId);
      const itemId = normalizeRequiredString(operation.payload.itemId);
      const relationKind = operation.payload.relationKind;
      if (!stagingId || !itemId || !isBlobRelationKind(relationKind)) {
        throw new Error('attach operation payload is invalid');
      }

      return {
        operationId,
        kind: 'attach',
        payload: {
          stagingId,
          itemId,
          relationKind,
          consistency: normalizeAttachConsistency(operation.payload.consistency)
        }
      };
    }

    throw new Error('operation.kind is invalid');
  }
}
