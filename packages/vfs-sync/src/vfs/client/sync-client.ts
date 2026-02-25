import {
  InMemoryVfsContainerClockStore,
  type ListVfsContainerClockChangesResult
} from '../protocol/sync-container-clocks.js';
import type { VfsCrdtOperation } from '../protocol/sync-crdt.js';
import { InMemoryVfsCrdtFeedReplayStore } from '../protocol/sync-crdt-feed-replay.js';
import { InMemoryVfsCrdtClientStateStore } from '../protocol/sync-crdt-reconcile.js';
import type { VfsSyncCursor } from '../protocol/sync-cursor.js';
import { compareVfsSyncCursorOrder } from '../protocol/sync-reconcile.js';
import { bumpLocalWriteIdFromReconcileState } from './sync-client-pending-operations.js';
import {
  normalizePersistedContainerClocks,
  normalizePersistedPendingOperation,
  normalizePersistedReconcileState,
  normalizePersistedReplaySnapshot
} from './sync-client-persistence-normalizers.js';
import { buildQueuedLocalOperation } from './sync-client-queue-local-operation.js';
import {
  rematerializeClientState,
  runWithRematerializationRecovery
} from './syncClientRematerialization.js';
import { pullUntilSettledLoop, runFlushLoop } from './sync-client-sync-loop.js';
import type {
  QueueVfsCrdtLocalOperationInput,
  VfsBackgroundSyncClientFlushResult,
  VfsBackgroundSyncClientOptions,
  VfsBackgroundSyncClientPersistedState,
  VfsBackgroundSyncClientSnapshot,
  VfsBackgroundSyncClientSyncResult,
  VfsCrdtRematerializationRequiredError,
  VfsRematerializationRequiredHandler,
  VfsCrdtSyncTransport,
  VfsSyncGuardrailViolation
} from './sync-client-utils.js';
import {
  cloneCursor,
  normalizeRequiredString,
  parseRematerializationAttempts,
  parsePositiveSafeInteger,
  parsePullLimit,
  validateClientId
} from './sync-client-utils.js';
export type * from './sync-client-utils.js';
export {
  delayVfsCrdtSyncTransport,
  VfsCrdtRematerializationRequiredError,
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
  private readonly maxRematerializationAttempts: number;
  private readonly onRematerializationRequired: VfsRematerializationRequiredHandler | null;

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
    this.maxRematerializationAttempts = parseRematerializationAttempts(
      options.maxRematerializationAttempts
    );
    this.onRematerializationRequired = options.onRematerializationRequired
      ? async (input) => options.onRematerializationRequired?.(input)
      : null;
  }

  queueLocalOperation(
    input: QueueVfsCrdtLocalOperationInput
  ): VfsCrdtOperation {
    const operation = buildQueuedLocalOperation({
      input,
      clientId: this.clientId,
      nextLocalWriteId: this.nextLocalWriteId,
      pendingOpIds: this.pendingOpIds,
      now: this.now
    });

    this.pendingOperations.push(operation);
    this.pendingOpIds.add(operation.opId);
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
      this.nextLocalWriteId = bumpLocalWriteIdFromReconcileState({
        reconcileState: this.reconcileStateStore.get(
          this.userId,
          this.clientId
        ),
        clientId: this.clientId,
        nextLocalWriteId: this.nextLocalWriteId
      });
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
    const dependencies = this.buildLoopDependencies();
    return runWithRematerializationRecovery({
      maxAttempts: this.maxRematerializationAttempts,
      execute: () => runFlushLoop(dependencies),
      rematerialize: (attempt, error) =>
        this.rematerializeState(attempt, error)
    });
  }

  private async pullUntilSettled(): Promise<VfsBackgroundSyncClientSyncResult> {
    const dependencies = this.buildLoopDependencies();
    return runWithRematerializationRecovery({
      maxAttempts: this.maxRematerializationAttempts,
      execute: () => pullUntilSettledLoop(dependencies),
      rematerialize: (attempt, error) =>
        this.rematerializeState(attempt, error)
    });
  }

  private buildLoopDependencies() {
    return {
      userId: this.userId,
      clientId: this.clientId,
      pullLimit: this.pullLimit,
      transport: this.transport,
      pendingOperations: this.pendingOperations,
      pendingOpIds: this.pendingOpIds,
      replayStore: this.replayStore,
      reconcileStateStore: this.reconcileStateStore,
      containerClockStore: this.containerClockStore,
      readNextLocalWriteId: () => this.nextLocalWriteId,
      writeNextLocalWriteId: (value: number) => {
        this.nextLocalWriteId = value;
      },
      emitGuardrailViolation: (violation: VfsSyncGuardrailViolation) => {
        this.emitGuardrailViolation(violation);
      }
    };
  }

  private async rematerializeState(
    attempt: number,
    error: VfsCrdtRematerializationRequiredError
  ): Promise<void> {
    this.nextLocalWriteId = await rematerializeClientState({
      userId: this.userId,
      clientId: this.clientId,
      attempt,
      error,
      stores: {
        replayStore: this.replayStore,
        reconcileStateStore: this.reconcileStateStore,
        containerClockStore: this.containerClockStore
      },
      pendingOperations: this.pendingOperations,
      nextLocalWriteId: this.nextLocalWriteId,
      onRematerializationRequired: this.onRematerializationRequired
    });
  }
}
