import {
  normalizePersistedContainerClocks,
  normalizePersistedPendingOperation,
  normalizePersistedReconcileState,
  normalizePersistedReplaySnapshot
} from './sync-client-persistence-normalizers.js';
import type {
  QueueVfsCrdtLocalOperationInput,
  VfsBackgroundSyncClientFlushResult,
  VfsBackgroundSyncClientOptions,
  VfsBackgroundSyncClientPersistedState,
  VfsBackgroundSyncClientSnapshot,
  VfsBackgroundSyncClientSyncResult,
  VfsCrdtSyncTransport,
  VfsSyncGuardrailViolation
} from './sync-client-utils.js';
import {
  assertNonRegressingLastWriteIds,
  cloneCursor,
  isAccessLevel,
  isPrincipalType,
  lastItemCursor,
  MAX_STALE_PUSH_RECOVERY_ATTEMPTS,
  normalizeCursor,
  normalizeOccurredAt,
  normalizeRequiredString,
  parsePositiveSafeInteger,
  parsePullLimit,
  VfsCrdtSyncPushRejectedError,
  validateClientId,
  validatePushResponse
} from './sync-client-utils.js';
import {
  InMemoryVfsContainerClockStore,
  type ListVfsContainerClockChangesResult
} from './sync-container-clocks.js';
import type { VfsCrdtOperation } from './sync-crdt.js';
import { InMemoryVfsCrdtFeedReplayStore } from './sync-crdt-feed-replay.js';
import {
  InMemoryVfsCrdtClientStateStore,
  parseVfsCrdtLastReconciledWriteIds
} from './sync-crdt-reconcile.js';
import type { VfsSyncCursor } from './sync-cursor.js';
import { compareVfsSyncCursorOrder } from './sync-reconcile.js';

export type * from './sync-client-utils.js';
export {
  delayVfsCrdtSyncTransport,
  VfsCrdtSyncPushRejectedError
} from './sync-client-utils.js';

export class VfsBackgroundSyncClient {
  private readonly userId: string;
  private readonly clientId: string;
  private readonly pullLimit: number;
  private readonly transport: VfsCrdtSyncTransport;
  private readonly now: () => Date;
  private readonly onBackgroundError: ((error: unknown) => void) | null;
  private readonly onGuardrailViolation:
    | ((violation: VfsSyncGuardrailViolation) => void)
    | null;

  private readonly pendingOperations: VfsCrdtOperation[] = [];
  private readonly pendingOpIds: Set<string> = new Set();
  private nextLocalWriteId = 1;

  private readonly replayStore = new InMemoryVfsCrdtFeedReplayStore();
  private readonly reconcileStateStore = new InMemoryVfsCrdtClientStateStore();
  private readonly containerClockStore = new InMemoryVfsContainerClockStore();

  private flushPromise: Promise<VfsBackgroundSyncClientFlushResult> | null =
    null;
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
    this.onGuardrailViolation = options.onGuardrailViolation ?? null;
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

      operation.principalType = principalType;
      operation.principalId = principalId;
      if (input.opType === 'acl_add') {
        const accessLevel = input.accessLevel;
        if (!isAccessLevel(accessLevel)) {
          throw new Error('accessLevel is required for acl_add');
        }

        operation.accessLevel = accessLevel;
      }
    }

    if (input.opType === 'link_add' || input.opType === 'link_remove') {
      const parentId = normalizeRequiredString(input.parentId);
      const childId = normalizeRequiredString(input.childId);
      if (!parentId || !childId) {
        throw new Error(
          'parentId and childId are required for link operations'
        );
      }
      if (childId !== normalizedItemId) {
        throw new Error('link childId must match itemId');
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

  exportState(): VfsBackgroundSyncClientPersistedState {
    const replaySnapshot = this.replayStore.snapshot();
    const reconcileState = this.reconcileStateStore.get(
      this.userId,
      this.clientId
    );

    return {
      replaySnapshot: {
        acl: replaySnapshot.acl.map((entry) => ({
          itemId: entry.itemId,
          principalType: entry.principalType,
          principalId: entry.principalId,
          accessLevel: entry.accessLevel
        })),
        links: replaySnapshot.links.map((entry) => ({
          parentId: entry.parentId,
          childId: entry.childId
        })),
        cursor: replaySnapshot.cursor
          ? cloneCursor(replaySnapshot.cursor)
          : null
      },
      reconcileState: reconcileState
        ? {
            cursor: cloneCursor(reconcileState.cursor),
            lastReconciledWriteIds: { ...reconcileState.lastReconciledWriteIds }
          }
        : null,
      containerClocks: this.containerClockStore.snapshot(),
      pendingOperations: this.pendingOperations.map((operation) => ({
        ...operation
      })),
      nextLocalWriteId: this.nextLocalWriteId
    };
  }

  hydrateState(state: VfsBackgroundSyncClientPersistedState): void {
    try {
      this.assertHydrationAllowed();
      if (typeof state !== 'object' || state === null) {
        throw new Error('state must be a non-null object');
      }

      if (!Array.isArray(state.pendingOperations)) {
        throw new Error('state.pendingOperations must be an array');
      }
      if (!Array.isArray(state.containerClocks)) {
        throw new Error('state.containerClocks must be an array');
      }

      const normalizedReplaySnapshot = normalizePersistedReplaySnapshot(
        state.replaySnapshot
      );
      const normalizedReconcileState = normalizePersistedReconcileState(
        state.reconcileState
      );
      const normalizedContainerClocks = normalizePersistedContainerClocks(
        state.containerClocks
      );

      /**
       * Guardrail invariant: reconcile cursor cannot trail the replay cursor for
       * the same persisted snapshot. Allowing this would regress effective pull
       * boundaries after restart and can replay or skip canonical feed entries.
       */
      if (
        normalizedReplaySnapshot.cursor &&
        normalizedReconcileState &&
        compareVfsSyncCursorOrder(
          normalizedReconcileState.cursor,
          normalizedReplaySnapshot.cursor
        ) < 0
      ) {
        throw new Error(
          'persisted reconcile cursor regressed persisted replay cursor'
        );
      }

      const effectivePersistedCursor =
        normalizedReconcileState?.cursor ?? normalizedReplaySnapshot.cursor;
      if (normalizedContainerClocks.length > 0 && !effectivePersistedCursor) {
        throw new Error(
          'state.containerClocks requires persisted replay or reconcile cursor'
        );
      }
      if (effectivePersistedCursor) {
        /**
         * Guardrail invariant: per-container clocks are a projection of replayed
         * feed history and therefore cannot advance beyond the persisted sync
         * cursor boundary. A clock ahead of this cursor indicates corruption.
         */
        for (let index = 0; index < normalizedContainerClocks.length; index++) {
          const clock = normalizedContainerClocks[index];
          if (
            clock &&
            compareVfsSyncCursorOrder(
              {
                changedAt: clock.changedAt,
                changeId: clock.changeId
              },
              effectivePersistedCursor
            ) > 0
          ) {
            throw new Error(
              `state.containerClocks[${index}] is ahead of persisted sync cursor`
            );
          }
        }
      }

      const normalizedPendingOperations: VfsCrdtOperation[] = [];
      const observedPendingOpIds: Set<string> = new Set();
      let maxPendingWriteId = 0;
      let previousWriteId = 0;
      for (let index = 0; index < state.pendingOperations.length; index++) {
        const operation = state.pendingOperations[index];
        if (!operation) {
          throw new Error(`state.pendingOperations[${index}] is invalid`);
        }

        const normalizedOperation = normalizePersistedPendingOperation({
          operation,
          index,
          clientId: this.clientId
        });
        if (observedPendingOpIds.has(normalizedOperation.opId)) {
          throw new Error(
            `state.pendingOperations has duplicate opId ${normalizedOperation.opId}`
          );
        }
        if (normalizedOperation.writeId <= previousWriteId) {
          throw new Error(
            'state.pendingOperations writeIds must be strictly increasing'
          );
        }

        observedPendingOpIds.add(normalizedOperation.opId);
        normalizedPendingOperations.push(normalizedOperation);
        maxPendingWriteId = Math.max(
          maxPendingWriteId,
          normalizedOperation.writeId
        );
        previousWriteId = normalizedOperation.writeId;
      }

      const persistedBoundaryChangeIds: Set<string> = new Set();
      if (normalizedReplaySnapshot.cursor) {
        persistedBoundaryChangeIds.add(
          normalizedReplaySnapshot.cursor.changeId
        );
      }
      if (normalizedReconcileState) {
        persistedBoundaryChangeIds.add(
          normalizedReconcileState.cursor.changeId
        );
      }
      for (const operation of normalizedPendingOperations) {
        if (persistedBoundaryChangeIds.has(operation.opId)) {
          throw new Error(
            `state.pendingOperations contains opId ${operation.opId} that collides with persisted cursor boundary`
          );
        }
      }

      this.replayStore.replaceSnapshot(normalizedReplaySnapshot);
      this.containerClockStore.replaceSnapshot(normalizedContainerClocks);

      if (normalizedReconcileState) {
        this.reconcileStateStore.reconcile(
          this.userId,
          this.clientId,
          normalizedReconcileState.cursor,
          normalizedReconcileState.lastReconciledWriteIds
        );
      }

      for (const operation of normalizedPendingOperations) {
        this.pendingOperations.push({ ...operation });
        this.pendingOpIds.add(operation.opId);
      }

      const persistedNextLocalWriteId = parsePositiveSafeInteger(
        state.nextLocalWriteId,
        'state.nextLocalWriteId'
      );
      this.nextLocalWriteId = Math.max(
        persistedNextLocalWriteId,
        maxPendingWriteId + 1
      );
      this.bumpLocalWriteIdFromReconcileState();
    } catch (error) {
      this.emitGuardrailViolation({
        code: 'hydrateGuardrailViolation',
        stage: 'hydrate',
        message:
          error instanceof Error ? error.message : 'state hydration failed'
      });
      throw error;
    }
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

  private emitGuardrailViolation(violation: VfsSyncGuardrailViolation): void {
    if (!this.onGuardrailViolation) {
      return;
    }

    try {
      this.onGuardrailViolation(violation);
    } catch {
      // Guardrail telemetry must never alter protocol control flow.
    }
  }

  private assertHydrationAllowed(): void {
    if (this.flushPromise) {
      throw new Error('cannot hydrate state while flush is in progress');
    }
    if (this.backgroundFlushTimer) {
      throw new Error('cannot hydrate state while background flush is active');
    }

    /**
     * Guardrail: hydration replaces all local client state. We only allow it on
     * a pristine client instance to avoid blending persisted state with live
     * mutable state from a previous process lifetime.
     */
    if (this.pendingOperations.length > 0 || this.pendingOpIds.size > 0) {
      throw new Error('cannot hydrate state on a non-empty pending queue');
    }
    const replaySnapshot = this.replayStore.snapshot();
    const reconcileState = this.reconcileStateStore.get(
      this.userId,
      this.clientId
    );
    const containerClocks = this.containerClockStore.snapshot();
    if (
      replaySnapshot.acl.length > 0 ||
      replaySnapshot.links.length > 0 ||
      replaySnapshot.cursor !== null ||
      reconcileState !== null ||
      containerClocks.length > 0 ||
      this.nextLocalWriteId !== 1
    ) {
      throw new Error('cannot hydrate state on a non-empty client');
    }
  }

  private async runFlush(): Promise<VfsBackgroundSyncClientFlushResult> {
    let pushedOperations = 0;
    let staleRecoveryAttempts = 0;

    while (this.pendingOperations.length > 0) {
      this.ensurePendingOccurredAtAfterCursor();
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

      for (const result of pushResults) {
        if (
          result.status === 'applied' ||
          result.status === 'alreadyApplied' ||
          result.status === 'outdatedOp'
        ) {
          if (this.removePendingOperationById(result.opId)) {
            pushedOperations += 1;
          }
        }
      }

      const invalidResults = rejectedResults.filter(
        (result) => result.status === 'invalidOp'
      );
      if (invalidResults.length > 0) {
        throw new VfsCrdtSyncPushRejectedError(invalidResults);
      }

      const staleResults = rejectedResults.filter(
        (result) => result.status === 'staleWriteId'
      );
      if (staleResults.length > 0) {
        /**
         * Guardrail: stale write IDs are only recoverable by first pulling and
         * synchronizing with server clock state, then rebasing queued writes.
         * A hard retry cap protects against infinite push loops when the server
         * cannot supply a forward-moving reconcile state.
         */
        staleRecoveryAttempts += 1;
        if (staleRecoveryAttempts > MAX_STALE_PUSH_RECOVERY_ATTEMPTS) {
          this.emitGuardrailViolation({
            code: 'staleWriteRecoveryExhausted',
            stage: 'flush',
            message:
              'stale write-id recovery exceeded max retry attempts without forward progress',
            details: {
              attempts: staleRecoveryAttempts,
              maxAttempts: MAX_STALE_PUSH_RECOVERY_ATTEMPTS,
              staleResults: staleResults.length
            }
          });
          throw new VfsCrdtSyncPushRejectedError(staleResults);
        }

        await this.pullUntilSettled();
        this.rebasePendingOperations(this.nextWriteIdFromReconcileState());
        continue;
      }

      staleRecoveryAttempts = 0;
    }

    const syncResult = await this.pullUntilSettled();
    return {
      pushedOperations,
      pulledOperations: syncResult.pulledOperations,
      pullPages: syncResult.pullPages
    };
  }

  private currentCursor(): VfsSyncCursor | null {
    const reconcileState = this.reconcileStateStore.get(
      this.userId,
      this.clientId
    );
    if (reconcileState) {
      return cloneCursor(reconcileState.cursor);
    }

    const replayCursor = this.replayStore.snapshot().cursor;
    return replayCursor ? cloneCursor(replayCursor) : null;
  }

  private bumpLocalWriteIdFromReconcileState(): void {
    const reconcileState = this.reconcileStateStore.get(
      this.userId,
      this.clientId
    );
    if (!reconcileState) {
      return;
    }

    const replicatedWriteId =
      reconcileState.lastReconciledWriteIds[this.clientId];
    if (typeof replicatedWriteId !== 'number') {
      return;
    }

    if (replicatedWriteId + 1 > this.nextLocalWriteId) {
      this.nextLocalWriteId = replicatedWriteId + 1;
    }
  }

  private nextWriteIdFromReconcileState(): number {
    const reconcileState = this.reconcileStateStore.get(
      this.userId,
      this.clientId
    );
    if (!reconcileState) {
      return this.nextLocalWriteId;
    }

    const replicatedWriteId =
      reconcileState.lastReconciledWriteIds[this.clientId];
    if (
      typeof replicatedWriteId !== 'number' ||
      !Number.isFinite(replicatedWriteId) ||
      !Number.isInteger(replicatedWriteId) ||
      replicatedWriteId < 0
    ) {
      return this.nextLocalWriteId;
    }

    return Math.max(this.nextLocalWriteId, replicatedWriteId + 1);
  }

  private rebasePendingOperations(nextWriteId: number): void {
    let writeId = Math.max(1, nextWriteId);
    const cursor = this.currentCursor();
    const cursorMs = cursor ? Date.parse(cursor.changedAt) : Number.NaN;
    let minOccurredAtMs = Number.isFinite(cursorMs)
      ? cursorMs
      : Number.NEGATIVE_INFINITY;

    /**
     * Guardrail: rebased queued operations must remain strictly ordered by both:
     * 1) replica writeId (monotonic per-client), and
     * 2) occurredAt (strictly after the reconciled cursor boundary)
     *
     * Without this, a recovered stale write can be accepted by push but then
     * skipped on pull because its timestamp falls at/before the local cursor.
     */
    for (const operation of this.pendingOperations) {
      operation.writeId = writeId;
      writeId += 1;

      const parsedOccurredAtMs = Date.parse(operation.occurredAt);
      let rebasedOccurredAtMs = Number.isFinite(parsedOccurredAtMs)
        ? parsedOccurredAtMs
        : minOccurredAtMs;
      if (
        !Number.isFinite(rebasedOccurredAtMs) ||
        rebasedOccurredAtMs <= minOccurredAtMs
      ) {
        rebasedOccurredAtMs = Number.isFinite(minOccurredAtMs)
          ? minOccurredAtMs + 1
          : Date.now();
      }

      operation.occurredAt = new Date(rebasedOccurredAtMs).toISOString();
      minOccurredAtMs = rebasedOccurredAtMs;
    }

    if (writeId > this.nextLocalWriteId) {
      this.nextLocalWriteId = writeId;
    }
  }

  private ensurePendingOccurredAtAfterCursor(): void {
    const cursor = this.currentCursor();
    if (!cursor) {
      return;
    }

    const parsedCursorMs = Date.parse(cursor.changedAt);
    if (!Number.isFinite(parsedCursorMs)) {
      return;
    }

    let minOccurredAtMs = parsedCursorMs;
    /**
     * Guardrail: queued writes must not be pushed with occurredAt timestamps at
     * or behind the reconciled cursor boundary. Otherwise a delayed push can be
     * inserted into canonical feed order before the cursor and become invisible
     * to subsequent pull windows on other replicas.
     */
    for (const operation of this.pendingOperations) {
      const parsedOccurredAtMs = Date.parse(operation.occurredAt);
      let normalizedOccurredAtMs = Number.isFinite(parsedOccurredAtMs)
        ? parsedOccurredAtMs
        : minOccurredAtMs;
      if (normalizedOccurredAtMs <= minOccurredAtMs) {
        normalizedOccurredAtMs = minOccurredAtMs + 1;
      }

      operation.occurredAt = new Date(normalizedOccurredAtMs).toISOString();
      minOccurredAtMs = normalizedOccurredAtMs;
    }
  }

  private removePendingOperationById(opId: string): boolean {
    const index = this.pendingOperations.findIndex(
      (operation) => operation.opId === opId
    );
    if (index < 0) {
      return false;
    }

    this.pendingOperations.splice(index, 1);
    this.pendingOpIds.delete(opId);
    return true;
  }

  private async reconcileWithTransportIfSupported(): Promise<void> {
    if (!this.transport.reconcileState) {
      return;
    }

    const localState = this.reconcileStateStore.get(this.userId, this.clientId);
    if (!localState) {
      return;
    }

    const normalizedLocalCursor = normalizeCursor(
      localState.cursor,
      'local reconcile cursor'
    );
    const localWriteIds = parseVfsCrdtLastReconciledWriteIds(
      localState.lastReconciledWriteIds
    );
    if (!localWriteIds.ok) {
      throw new Error(localWriteIds.error);
    }

    const response = await this.transport.reconcileState({
      userId: this.userId,
      clientId: this.clientId,
      cursor: cloneCursor(normalizedLocalCursor),
      lastReconciledWriteIds: { ...localWriteIds.value }
    });

    /**
     * Guardrail: remote reconcile acknowledgements must be valid and must never
     * move backwards. If this fails, the client aborts immediately to prevent
     * future writes from being emitted with stale cursor or replica-clock state.
     */
    const normalizedResponseCursor = normalizeCursor(
      response.cursor,
      'reconcile cursor'
    );
    const responseWriteIds = parseVfsCrdtLastReconciledWriteIds(
      response.lastReconciledWriteIds
    );
    if (!responseWriteIds.ok) {
      throw new Error(responseWriteIds.error);
    }

    if (
      compareVfsSyncCursorOrder(
        normalizedResponseCursor,
        normalizedLocalCursor
      ) < 0
    ) {
      this.emitGuardrailViolation({
        code: 'reconcileCursorRegression',
        stage: 'reconcile',
        message: 'reconcile acknowledgement regressed sync cursor',
        details: {
          previousChangedAt: normalizedLocalCursor.changedAt,
          previousChangeId: normalizedLocalCursor.changeId,
          incomingChangedAt: normalizedResponseCursor.changedAt,
          incomingChangeId: normalizedResponseCursor.changeId
        }
      });
      throw new Error('transport reconcile regressed sync cursor');
    }

    const observedWriteIds = new Map<string, number>(
      Object.entries(localWriteIds.value)
    );
    assertNonRegressingLastWriteIds(
      observedWriteIds,
      responseWriteIds.value,
      ({ replicaId, previousWriteId, incomingWriteId }) => {
        this.emitGuardrailViolation({
          code: 'lastWriteIdRegression',
          stage: 'reconcile',
          message: 'reconcile acknowledgement regressed replica write-id state',
          details: {
            replicaId,
            previousWriteId,
            incomingWriteId
          }
        });
      }
    );

    this.reconcileStateStore.reconcile(
      this.userId,
      this.clientId,
      normalizedResponseCursor,
      responseWriteIds.value
    );
    this.bumpLocalWriteIdFromReconcileState();
  }

  private async pullUntilSettled(): Promise<VfsBackgroundSyncClientSyncResult> {
    let pulledOperations = 0;
    let pullPages = 0;
    const localReconcileState = this.reconcileStateStore.get(
      this.userId,
      this.clientId
    );
    /**
     * Guardrail: pull responses must remain monotonic not only within a single
     * paginated sync loop but also relative to the durable local reconcile
     * baseline established by prior successful cycles (including restarts).
     */
    const observedLastWriteIds = new Map<string, number>(
      Object.entries(localReconcileState?.lastReconciledWriteIds ?? {})
    );
    const observedPullOpIds = new Set<string>();

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
        parsedWriteIds.value,
        ({ replicaId, previousWriteId, incomingWriteId }) => {
          this.emitGuardrailViolation({
            code: 'lastWriteIdRegression',
            stage: 'pull',
            message: 'pull response regressed replica write-id state',
            details: {
              replicaId,
              previousWriteId,
              incomingWriteId
            }
          });
        }
      );

      if (response.hasMore && response.items.length === 0) {
        this.emitGuardrailViolation({
          code: 'pullPageInvariantViolation',
          stage: 'pull',
          message: 'pull response hasMore=true with an empty page',
          details: {
            hasMore: true,
            itemsLength: 0
          }
        });
        throw new Error(
          'transport returned hasMore=true with an empty pull page'
        );
      }

      let pageCursor: VfsSyncCursor | null = null;
      if (response.items.length > 0) {
        /**
         * Guardrail: a single pull cycle must never replay an opId across page
         * boundaries. Replay indicates a broken cursor contract and can cause
         * non-deterministic reapplication or stalled pagination.
         */
        for (const item of response.items) {
          const opId = normalizeRequiredString(item.opId);
          if (!opId) {
            throw new Error('transport returned item with missing opId');
          }

          if (observedPullOpIds.has(opId)) {
            this.emitGuardrailViolation({
              code: 'pullDuplicateOpReplay',
              stage: 'pull',
              message:
                'pull response replayed an opId within one pull-until-settled cycle',
              details: {
                opId
              }
            });
            throw new Error(
              `transport replayed opId ${opId} during pull pagination`
            );
          }

          observedPullOpIds.add(opId);
        }

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
          this.emitGuardrailViolation({
            code: 'pullPageInvariantViolation',
            stage: 'pull',
            message: 'pull response nextCursor does not match page tail cursor',
            details: {
              nextCursorChangedAt: response.nextCursor.changedAt,
              nextCursorChangeId: response.nextCursor.changeId,
              pageCursorChangedAt: pageCursor.changedAt,
              pageCursorChangeId: pageCursor.changeId
            }
          });
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
        this.emitGuardrailViolation({
          code: 'pullCursorRegression',
          stage: 'pull',
          message: 'pull response regressed local sync cursor',
          details: {
            previousChangedAt: cursorBeforePull.changedAt,
            previousChangeId: cursorBeforePull.changeId,
            incomingChangedAt: pageCursor.changedAt,
            incomingChangeId: pageCursor.changeId
          }
        });
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
        /**
         * Guardrail: when supported, finalize each pull cycle by explicitly
         * reconciling cursor + replica clocks with the server-side state table.
         * This keeps device-local state and durable server checkpoints aligned.
         */
        await this.reconcileWithTransportIfSupported();
        return {
          pulledOperations,
          pullPages
        };
      }
    }
  }
}
