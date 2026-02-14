import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtSyncItem
} from '@tearleads/shared';
import { InMemoryVfsCrdtFeedReplayStore } from './sync-crdt-feed-replay.js';
import type { VfsCrdtOperation, VfsCrdtOpType } from './sync-crdt.js';
import {
  InMemoryVfsCrdtClientStateStore,
  parseVfsCrdtLastReconciledWriteIds,
  type VfsCrdtLastReconciledWriteIds
} from './sync-crdt-reconcile.js';
import {
  InMemoryVfsContainerClockStore,
  type ListVfsContainerClockChangesResult,
  type VfsContainerClockEntry
} from './sync-container-clocks.js';
import type { VfsSyncCursor } from './sync-cursor.js';
import { compareVfsSyncCursorOrder } from './sync-reconcile.js';

const DEFAULT_PULL_LIMIT = 100;
const MAX_PULL_LIMIT = 500;
const MAX_CLIENT_ID_LENGTH = 128;

const VALID_ACCESS_LEVELS: VfsAclAccessLevel[] = ['read', 'write', 'admin'];
const VALID_PRINCIPAL_TYPES: VfsAclPrincipalType[] = [
  'user',
  'group',
  'organization'
];

function isAccessLevel(value: unknown): value is VfsAclAccessLevel {
  return (
    typeof value === 'string' &&
    VALID_ACCESS_LEVELS.some((candidate) => candidate === value)
  );
}

function isPrincipalType(value: unknown): value is VfsAclPrincipalType {
  return (
    typeof value === 'string' &&
    VALID_PRINCIPAL_TYPES.some((candidate) => candidate === value)
  );
}

function normalizeRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOccurredAt(value: unknown): string | null {
  const normalized = normalizeRequiredString(value);
  if (!normalized) {
    return null;
  }

  const parsedMs = Date.parse(normalized);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  return new Date(parsedMs).toISOString();
}

function sleep(ms: number): Promise<void> {
  if (ms < 1) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parsePullLimit(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_PULL_LIMIT;
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(
      `pullLimit must be an integer between 1 and ${MAX_PULL_LIMIT}`
    );
  }

  if (value < 1 || value > MAX_PULL_LIMIT) {
    throw new Error(
      `pullLimit must be an integer between 1 and ${MAX_PULL_LIMIT}`
    );
  }

  return value;
}

function validateClientId(value: string): void {
  if (value.length === 0 || value.length > MAX_CLIENT_ID_LENGTH) {
    throw new Error('clientId must be non-empty and at most 128 characters');
  }

  if (value.includes(':')) {
    throw new Error('clientId must not include ":"');
  }
}

function cloneCursor(cursor: VfsSyncCursor): VfsSyncCursor {
  return {
    changedAt: cursor.changedAt,
    changeId: cursor.changeId
  };
}

function toCursorFromItem(item: VfsCrdtSyncItem): VfsSyncCursor {
  const occurredAtMs = Date.parse(item.occurredAt);
  if (!Number.isFinite(occurredAtMs)) {
    throw new Error('transport returned item with invalid occurredAt');
  }

  const changeId = normalizeRequiredString(item.opId);
  if (!changeId) {
    throw new Error('transport returned item with missing opId');
  }

  return {
    changedAt: new Date(occurredAtMs).toISOString(),
    changeId
  };
}

function lastItemCursor(items: VfsCrdtSyncItem[]): VfsSyncCursor | null {
  if (items.length === 0) {
    return null;
  }

  const lastItem = items[items.length - 1];
  if (!lastItem) {
    return null;
  }

  return toCursorFromItem(lastItem);
}

function isPushStatus(value: unknown): value is VfsCrdtSyncPushStatus {
  return (
    value === 'applied' ||
    value === 'alreadyApplied' ||
    value === 'staleWriteId' ||
    value === 'outdatedOp' ||
    value === 'invalidOp'
  );
}

export interface VfsCrdtSyncPullResponse {
  items: VfsCrdtSyncItem[];
  hasMore: boolean;
  nextCursor: VfsSyncCursor | null;
  lastReconciledWriteIds: VfsCrdtLastReconciledWriteIds;
}

export type VfsCrdtSyncPushStatus =
  | 'applied'
  | 'alreadyApplied'
  | 'staleWriteId'
  | 'outdatedOp'
  | 'invalidOp';

export interface VfsCrdtSyncPushResult {
  opId: string;
  status: VfsCrdtSyncPushStatus;
}

export interface VfsCrdtSyncPushResponse {
  results: VfsCrdtSyncPushResult[];
}

export interface VfsCrdtSyncTransport {
  pushOperations(input: {
    userId: string;
    clientId: string;
    operations: VfsCrdtOperation[];
  }): Promise<VfsCrdtSyncPushResponse>;
  pullOperations(input: {
    userId: string;
    clientId: string;
    cursor: VfsSyncCursor | null;
    limit: number;
  }): Promise<VfsCrdtSyncPullResponse>;
}

export class VfsCrdtSyncPushRejectedError extends Error {
  readonly rejectedResults: VfsCrdtSyncPushResult[];

  constructor(results: VfsCrdtSyncPushResult[]) {
    super('push rejected one or more operations');
    this.name = 'VfsCrdtSyncPushRejectedError';
    this.rejectedResults = results;
  }
}

function validatePushResponse(
  operations: VfsCrdtOperation[],
  response: VfsCrdtSyncPushResponse
): VfsCrdtSyncPushResult[] {
  if (!Array.isArray(response.results)) {
    throw new Error('transport returned invalid push response');
  }

  if (response.results.length !== operations.length) {
    throw new Error('transport returned mismatched push response size');
  }

  const byOpId = new Map<string, VfsCrdtSyncPushResult>();
  for (const result of response.results) {
    if (
      !result ||
      typeof result.opId !== 'string' ||
      !isPushStatus(result.status)
    ) {
      throw new Error('transport returned invalid push result');
    }

    byOpId.set(result.opId, result);
  }

  const orderedResults: VfsCrdtSyncPushResult[] = [];
  for (const operation of operations) {
    const result = byOpId.get(operation.opId);
    if (!result) {
      throw new Error(
        `transport push response missing result for opId ${operation.opId}`
      );
    }

    orderedResults.push(result);
  }

  return orderedResults;
}

function assertNonRegressingLastWriteIds(
  observedLastWriteIds: Map<string, number>,
  incomingLastWriteIds: VfsCrdtLastReconciledWriteIds
): void {
  for (const [replicaId, writeId] of Object.entries(incomingLastWriteIds)) {
    const previousWriteId = observedLastWriteIds.get(replicaId) ?? 0;
    if (writeId < previousWriteId) {
      throw new Error(
        `transport regressed lastReconciledWriteIds for replica ${replicaId}`
      );
    }

    if (writeId > previousWriteId) {
      observedLastWriteIds.set(replicaId, writeId);
    }
  }
}

export interface QueueVfsCrdtLocalOperationInput {
  opType: VfsCrdtOpType;
  itemId: string;
  principalType?: VfsAclPrincipalType;
  principalId?: string;
  accessLevel?: VfsAclAccessLevel;
  parentId?: string;
  childId?: string;
  occurredAt?: string;
  opId?: string;
}

export interface VfsBackgroundSyncClientOptions {
  pullLimit?: number;
  now?: () => Date;
  onBackgroundError?: (error: unknown) => void;
}

export interface VfsBackgroundSyncClientFlushResult {
  pushedOperations: number;
  pulledOperations: number;
  pullPages: number;
}

export interface VfsBackgroundSyncClientSyncResult {
  pulledOperations: number;
  pullPages: number;
}

export interface VfsBackgroundSyncClientSnapshot {
  acl: Array<{
    itemId: string;
    principalType: VfsAclPrincipalType;
    principalId: string;
    accessLevel: VfsAclAccessLevel;
  }>;
  links: Array<{
    parentId: string;
    childId: string;
  }>;
  cursor: VfsSyncCursor | null;
  lastReconciledWriteIds: VfsCrdtLastReconciledWriteIds;
  containerClocks: VfsContainerClockEntry[];
  pendingOperations: number;
  nextLocalWriteId: number;
}

export class VfsBackgroundSyncClient {
  private readonly userId: string;
  private readonly clientId: string;
  private readonly pullLimit: number;
  private readonly transport: VfsCrdtSyncTransport;
  private readonly now: () => Date;
  private readonly onBackgroundError: ((error: unknown) => void) | null;

  private readonly pendingOperations: VfsCrdtOperation[] = [];
  private readonly pendingOpIds: Set<string> = new Set();
  private nextLocalWriteId = 1;

  private readonly replayStore = new InMemoryVfsCrdtFeedReplayStore();
  private readonly reconcileStateStore = new InMemoryVfsCrdtClientStateStore();
  private readonly containerClockStore = new InMemoryVfsContainerClockStore();

  private flushPromise: Promise<VfsBackgroundSyncClientFlushResult> | null = null;
  private backgroundFlushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    userId: string,
    clientId: string,
    transport: VfsCrdtSyncTransport,
    options: VfsBackgroundSyncClientOptions = {}
  ) {
    const normalizedUserId = normalizeRequiredString(userId);
    const normalizedClientId = normalizeRequiredString(clientId);

    if (!normalizedUserId) {
      throw new Error('userId is required');
    }
    if (!normalizedClientId) {
      throw new Error('clientId is required');
    }
    validateClientId(normalizedClientId);

    this.userId = normalizedUserId;
    this.clientId = normalizedClientId;
    this.transport = transport;
    this.pullLimit = parsePullLimit(options.pullLimit);
    this.now = options.now ?? (() => new Date());
    this.onBackgroundError = options.onBackgroundError ?? null;
  }

  queueLocalOperation(
    input: QueueVfsCrdtLocalOperationInput
  ): VfsCrdtOperation {
    const normalizedItemId = normalizeRequiredString(input.itemId);
    if (!normalizedItemId) {
      throw new Error('itemId is required');
    }

    const writeId = this.nextLocalWriteId;

    const normalizedOccurredAt = normalizeOccurredAt(input.occurredAt);
    const occurredAt = normalizedOccurredAt ?? this.now().toISOString();
    const parsedOccurredAt = normalizeOccurredAt(occurredAt);
    if (!parsedOccurredAt) {
      throw new Error('occurredAt is invalid');
    }

    const candidateOpId = input.opId ?? `${this.clientId}-${writeId}`;
    const normalizedOpId = normalizeRequiredString(candidateOpId);
    if (!normalizedOpId) {
      throw new Error('opId is required');
    }
    if (this.pendingOpIds.has(normalizedOpId)) {
      throw new Error(`opId ${normalizedOpId} is already queued`);
    }

    const operation: VfsCrdtOperation = {
      opId: normalizedOpId,
      opType: input.opType,
      itemId: normalizedItemId,
      replicaId: this.clientId,
      writeId,
      occurredAt: parsedOccurredAt
    };

    if (input.opType === 'acl_add' || input.opType === 'acl_remove') {
      const principalType = input.principalType;
      const principalId = normalizeRequiredString(input.principalId);

      if (!isPrincipalType(principalType) || !principalId) {
        throw new Error(
          'principalType and principalId are required for acl operations'
        );
      }

      if (input.opType === 'acl_add' && !isAccessLevel(input.accessLevel)) {
        throw new Error('accessLevel is required for acl_add');
      }

      operation.principalType = principalType;
      operation.principalId = principalId;
      if (input.opType === 'acl_add') {
        operation.accessLevel = input.accessLevel;
      }
    }

    if (input.opType === 'link_add' || input.opType === 'link_remove') {
      const parentId = normalizeRequiredString(input.parentId);
      const childId = normalizeRequiredString(input.childId);
      if (!parentId || !childId) {
        throw new Error('parentId and childId are required for link operations');
      }

      operation.parentId = parentId;
      operation.childId = childId;
    }

    this.pendingOperations.push(operation);
    this.pendingOpIds.add(normalizedOpId);
    this.nextLocalWriteId += 1;
    return { ...operation };
  }

  queuedOperations(): VfsCrdtOperation[] {
    return this.pendingOperations.map((operation) => ({ ...operation }));
  }

  snapshot(): VfsBackgroundSyncClientSnapshot {
    const replaySnapshot = this.replayStore.snapshot();
    const reconcileState = this.reconcileStateStore.get(
      this.userId,
      this.clientId
    );

    return {
      acl: replaySnapshot.acl,
      links: replaySnapshot.links,
      cursor: reconcileState?.cursor ?? replaySnapshot.cursor,
      lastReconciledWriteIds: reconcileState?.lastReconciledWriteIds ?? {},
      containerClocks: this.containerClockStore.snapshot(),
      pendingOperations: this.pendingOperations.length,
      nextLocalWriteId: this.nextLocalWriteId
    };
  }

  listChangedContainers(
    cursor: VfsSyncCursor | null,
    limit?: number
  ): ListVfsContainerClockChangesResult {
    return this.containerClockStore.listChangedSince(cursor, limit);
  }

  async sync(): Promise<VfsBackgroundSyncClientSyncResult> {
    return this.pullUntilSettled();
  }

  async flush(): Promise<VfsBackgroundSyncClientFlushResult> {
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

  startBackgroundFlush(intervalMs: number): void {
    if (!Number.isInteger(intervalMs) || intervalMs < 1) {
      throw new Error('intervalMs must be a positive integer');
    }

    if (this.backgroundFlushTimer) {
      return;
    }

    this.backgroundFlushTimer = setInterval(() => {
      void this.flush().catch((error) => {
        if (this.onBackgroundError) {
          this.onBackgroundError(error);
        }
      });
    }, intervalMs);
  }

  async stopBackgroundFlush(waitForInFlightFlush = true): Promise<void> {
    if (!this.backgroundFlushTimer) {
      return;
    }

    clearInterval(this.backgroundFlushTimer);
    this.backgroundFlushTimer = null;

    if (waitForInFlightFlush && this.flushPromise) {
      await this.flushPromise.catch(() => {
        // no-op: caller controls error handling through onBackgroundError
      });
    }
  }

  private async runFlush(): Promise<VfsBackgroundSyncClientFlushResult> {
    let pushedOperations = 0;

    while (this.pendingOperations.length > 0) {
      const currentBatch = this.pendingOperations.slice();
      const pushResponse = await this.transport.pushOperations({
        userId: this.userId,
        clientId: this.clientId,
        operations: currentBatch
      });

      const pushResults = validatePushResponse(currentBatch, pushResponse);
      const rejectedResults = pushResults.filter(
        (result) =>
          result.status === 'staleWriteId' || result.status === 'invalidOp'
      );
      if (rejectedResults.length > 0) {
        throw new VfsCrdtSyncPushRejectedError(rejectedResults);
      }

      this.pendingOperations.splice(0, currentBatch.length);
      for (const operation of currentBatch) {
        this.pendingOpIds.delete(operation.opId);
      }
      pushedOperations += currentBatch.length;
    }

    const syncResult = await this.pullUntilSettled();
    return {
      pushedOperations,
      pulledOperations: syncResult.pulledOperations,
      pullPages: syncResult.pullPages
    };
  }

  private currentCursor(): VfsSyncCursor | null {
    const reconcileState = this.reconcileStateStore.get(this.userId, this.clientId);
    if (reconcileState) {
      return cloneCursor(reconcileState.cursor);
    }

    const replayCursor = this.replayStore.snapshot().cursor;
    return replayCursor ? cloneCursor(replayCursor) : null;
  }

  private bumpLocalWriteIdFromReconcileState(): void {
    const reconcileState = this.reconcileStateStore.get(this.userId, this.clientId);
    if (!reconcileState) {
      return;
    }

    const replicatedWriteId = reconcileState.lastReconciledWriteIds[this.clientId];
    if (typeof replicatedWriteId !== 'number') {
      return;
    }

    if (replicatedWriteId + 1 > this.nextLocalWriteId) {
      this.nextLocalWriteId = replicatedWriteId + 1;
    }
  }

  private async pullUntilSettled(): Promise<VfsBackgroundSyncClientSyncResult> {
    let pulledOperations = 0;
    let pullPages = 0;
    const observedLastWriteIds = new Map<string, number>();

    while (true) {
      const cursorBeforePull = this.currentCursor();
      const response = await this.transport.pullOperations({
        userId: this.userId,
        clientId: this.clientId,
        cursor: cursorBeforePull,
        limit: this.pullLimit
      });
      pullPages += 1;

      const parsedWriteIds = parseVfsCrdtLastReconciledWriteIds(
        response.lastReconciledWriteIds
      );
      if (!parsedWriteIds.ok) {
        throw new Error(parsedWriteIds.error);
      }
      assertNonRegressingLastWriteIds(
        observedLastWriteIds,
        parsedWriteIds.value
      );

      if (response.hasMore && response.items.length === 0) {
        throw new Error(
          'transport returned hasMore=true with an empty pull page'
        );
      }

      let pageCursor: VfsSyncCursor | null = null;
      if (response.items.length > 0) {
        this.replayStore.applyPage(response.items);
        this.containerClockStore.applyFeedItems(response.items);
        pulledOperations += response.items.length;

        pageCursor = lastItemCursor(response.items);
        if (!pageCursor) {
          throw new Error('pull page had items but missing terminal cursor');
        }

        if (
          response.nextCursor &&
          compareVfsSyncCursorOrder(response.nextCursor, pageCursor) !== 0
        ) {
          throw new Error(
            'transport returned nextCursor that does not match pull page tail'
          );
        }
      } else if (response.nextCursor) {
        pageCursor = cloneCursor(response.nextCursor);
      } else if (cursorBeforePull) {
        pageCursor = cloneCursor(cursorBeforePull);
      }

      if (
        cursorBeforePull &&
        pageCursor &&
        compareVfsSyncCursorOrder(pageCursor, cursorBeforePull) < 0
      ) {
        throw new Error('transport returned regressing sync cursor');
      }

      if (pageCursor) {
        this.reconcileStateStore.reconcile(
          this.userId,
          this.clientId,
          pageCursor,
          parsedWriteIds.value
        );
        this.bumpLocalWriteIdFromReconcileState();
      }

      if (!response.hasMore) {
        return {
          pulledOperations,
          pullPages
        };
      }
    }
  }
}

export interface InMemoryVfsCrdtSyncTransportDelayConfig {
  pushDelayMs?: number;
  pullDelayMs?: number;
}

export async function delayVfsCrdtSyncTransport(
  delays: InMemoryVfsCrdtSyncTransportDelayConfig,
  type: 'push' | 'pull'
): Promise<void> {
  const delayMs = type === 'push' ? delays.pushDelayMs : delays.pullDelayMs;
  if (typeof delayMs !== 'number' || !Number.isFinite(delayMs)) {
    return;
  }

  await sleep(delayMs);
}
