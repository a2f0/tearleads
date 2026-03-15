import {
  InMemoryVfsContainerClockStore,
  type ListVfsContainerClockChangesResult
} from '../protocol/sync-container-clocks.js';
import type { VfsCrdtOperation } from '../protocol/sync-crdt.js';
import { InMemoryVfsCrdtFeedReplayStore } from '../protocol/sync-crdt-feed-replay.js';
import { InMemoryVfsCrdtClientStateStore } from '../protocol/sync-crdt-reconcile.js';
import type { VfsSyncCursor } from '../protocol/sync-cursor.js';
import { bumpLocalWriteIdFromReconcileState } from './sync-client-pending-operations.js';
import { buildQueuedLocalOperation } from './sync-client-queue-local-operation.js';
import { pullUntilSettledLoop, runFlushLoop } from './sync-client-sync-loop.js';
import type {
  QueueVfsCrdtLocalOperationInput,
  VfsAclOperationSigner,
  VfsBackgroundSyncClientFlushResult,
  VfsBackgroundSyncClientOptions,
  VfsBackgroundSyncClientPersistedState,
  VfsBackgroundSyncClientSnapshot,
  VfsBackgroundSyncClientSyncResult,
  VfsCrdtRematerializationRequiredError,
  VfsCrdtSyncTransport,
  VfsRematerializationRequiredHandler,
  VfsSyncGuardrailViolation
} from './sync-client-utils.js';
import {
  cloneCursor,
  normalizeRequiredString,
  parsePositiveSafeInteger,
  parsePullLimit,
  parseRematerializationAttempts,
  validateClientId
} from './sync-client-utils.js';
import { VfsAclTofuKeyStore } from './syncClientAclKeyStore.js';
import type { VfsAclVerificationHandler } from './syncClientAclVerification.js';
import { validateAndNormalizeHydrationState } from './syncClientHydration.js';
import {
  rematerializeClientState,
  runWithRematerializationRecovery
} from './syncClientRematerialization.js';

export type * from './sync-client-utils.js';
export {
  delayVfsCrdtSyncTransport,
  VfsCrdtRematerializationRequiredError,
  VfsCrdtSyncPushRejectedError
} from './sync-client-utils.js';
export { VfsAclTofuKeyStore } from './syncClientAclKeyStore.js';
export type {
  VfsAclVerificationFailure,
  VfsAclVerificationFailureReason,
  VfsAclVerificationHandler
} from './syncClientAclVerification.js';

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
  private readonly signAclOperation: VfsAclOperationSigner | null;
  private readonly verifyAclSignaturesOnPull: boolean;
  private readonly tofuKeyStore: VfsAclTofuKeyStore | null;
  private readonly onAclVerificationFailure: VfsAclVerificationHandler | null;
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
    this.signAclOperation = options.signAclOperation ?? null;
    this.verifyAclSignaturesOnPull = options.verifyAclSignaturesOnPull ?? false;
    this.tofuKeyStore = this.verifyAclSignaturesOnPull
      ? new VfsAclTofuKeyStore()
      : null;
    this.onAclVerificationFailure = options.onAclVerificationFailure ?? null;
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
      pendingOperations: this.queuedOperations(),
      nextLocalWriteId: this.nextLocalWriteId
    };
  }

  hydrateState(state: VfsBackgroundSyncClientPersistedState): void {
    try {
      this.assertHydrationAllowed();

      const validated = validateAndNormalizeHydrationState(
        state,
        this.clientId
      );

      this.replayStore.replaceSnapshot(validated.replaySnapshot);
      this.containerClockStore.replaceSnapshot(validated.containerClocks);

      if (validated.reconcileState) {
        this.reconcileStateStore.reconcile(
          this.userId,
          this.clientId,
          validated.reconcileState.cursor,
          validated.reconcileState.lastReconciledWriteIds
        );
      }

      for (const operation of validated.pendingOperations) {
        this.pendingOperations.push({ ...operation });
        this.pendingOpIds.add(operation.opId);
      }

      const persistedNextLocalWriteId = parsePositiveSafeInteger(
        state.nextLocalWriteId,
        'state.nextLocalWriteId'
      );
      this.nextLocalWriteId = Math.max(
        persistedNextLocalWriteId,
        validated.maxPendingWriteId + 1
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
      rematerialize: (attempt, error) => this.rematerializeState(attempt, error)
    });
  }

  private async pullUntilSettled(): Promise<VfsBackgroundSyncClientSyncResult> {
    const dependencies = this.buildLoopDependencies();
    return runWithRematerializationRecovery({
      maxAttempts: this.maxRematerializationAttempts,
      execute: () => pullUntilSettledLoop(dependencies),
      rematerialize: (attempt, error) => this.rematerializeState(attempt, error)
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
      signAclOperation: this.signAclOperation,
      verifyAclSignaturesOnPull: this.verifyAclSignaturesOnPull,
      tofuKeyStore: this.tofuKeyStore,
      onAclVerificationFailure: this.onAclVerificationFailure,
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
