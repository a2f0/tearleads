import {
  bumpLocalWriteIdFromReconcileState,
  ensurePendingOccurredAtAfterCursor,
  getCurrentCursorFromState,
  nextWriteIdFromReconcileState,
  rebasePendingOperations,
  removePendingOperationById
} from './sync-client-pending-operations.js';
import type {
  VfsBackgroundSyncClientFlushResult,
  VfsBackgroundSyncClientSyncResult,
  VfsCrdtSyncTransport,
  VfsSyncGuardrailViolation
} from './sync-client-utils.js';
import {
  assertNonRegressingLastWriteIds,
  cloneCursor,
  lastItemCursor,
  MAX_STALE_PUSH_RECOVERY_ATTEMPTS,
  normalizeCursor,
  normalizeRequiredString,
  VfsCrdtSyncPushRejectedError,
  validatePushResponse
} from './sync-client-utils.js';
import type { InMemoryVfsContainerClockStore } from './sync-container-clocks.js';
import type { VfsCrdtOperation } from './sync-crdt.js';
import type { InMemoryVfsCrdtFeedReplayStore } from './sync-crdt-feed-replay.js';
import {
  type InMemoryVfsCrdtClientStateStore,
  parseVfsCrdtLastReconciledWriteIds
} from './sync-crdt-reconcile.js';
import type { VfsSyncCursor } from './sync-cursor.js';
import { compareVfsSyncCursorOrder } from './sync-reconcile.js';

export interface VfsSyncClientLoopDependencies {
  userId: string;
  clientId: string;
  pullLimit: number;
  transport: VfsCrdtSyncTransport;
  pendingOperations: VfsCrdtOperation[];
  pendingOpIds: Set<string>;
  replayStore: InMemoryVfsCrdtFeedReplayStore;
  reconcileStateStore: InMemoryVfsCrdtClientStateStore;
  containerClockStore: InMemoryVfsContainerClockStore;
  readNextLocalWriteId: () => number;
  writeNextLocalWriteId: (value: number) => void;
  emitGuardrailViolation: (violation: VfsSyncGuardrailViolation) => void;
}

function bumpLocalWriteId(dependencies: VfsSyncClientLoopDependencies): void {
  dependencies.writeNextLocalWriteId(
    bumpLocalWriteIdFromReconcileState({
      reconcileState: dependencies.reconcileStateStore.get(
        dependencies.userId,
        dependencies.clientId
      ),
      clientId: dependencies.clientId,
      nextLocalWriteId: dependencies.readNextLocalWriteId()
    })
  );
}

async function reconcileWithTransportIfSupported(
  dependencies: VfsSyncClientLoopDependencies
): Promise<void> {
  if (!dependencies.transport.reconcileState) {
    return;
  }

  const localState = dependencies.reconcileStateStore.get(
    dependencies.userId,
    dependencies.clientId
  );
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

  const response = await dependencies.transport.reconcileState({
    userId: dependencies.userId,
    clientId: dependencies.clientId,
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
    compareVfsSyncCursorOrder(normalizedResponseCursor, normalizedLocalCursor) <
    0
  ) {
    dependencies.emitGuardrailViolation({
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
      dependencies.emitGuardrailViolation({
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

  dependencies.reconcileStateStore.reconcile(
    dependencies.userId,
    dependencies.clientId,
    normalizedResponseCursor,
    responseWriteIds.value
  );
  bumpLocalWriteId(dependencies);
}

export async function pullUntilSettledLoop(
  dependencies: VfsSyncClientLoopDependencies
): Promise<VfsBackgroundSyncClientSyncResult> {
  let pulledOperations = 0;
  let pullPages = 0;
  const localReconcileState = dependencies.reconcileStateStore.get(
    dependencies.userId,
    dependencies.clientId
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
    const cursorBeforePull = getCurrentCursorFromState({
      reconcileState: dependencies.reconcileStateStore.get(
        dependencies.userId,
        dependencies.clientId
      ),
      replayCursor: dependencies.replayStore.snapshot().cursor
    });
    const response = await dependencies.transport.pullOperations({
      userId: dependencies.userId,
      clientId: dependencies.clientId,
      cursor: cursorBeforePull,
      limit: dependencies.pullLimit
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
        dependencies.emitGuardrailViolation({
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
      dependencies.emitGuardrailViolation({
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

    const pullItemsApplied = response.items.length > 0;
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
          dependencies.emitGuardrailViolation({
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

      pageCursor = lastItemCursor(response.items);
      if (!pageCursor) {
        throw new Error('pull page had items but missing terminal cursor');
      }

      if (
        response.nextCursor &&
        compareVfsSyncCursorOrder(response.nextCursor, pageCursor) !== 0
      ) {
        dependencies.emitGuardrailViolation({
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
      dependencies.emitGuardrailViolation({
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

    if (pullItemsApplied) {
      dependencies.replayStore.applyPage(response.items);
      dependencies.containerClockStore.applyFeedItems(response.items);
      pulledOperations += response.items.length;
    }

    if (pageCursor) {
      dependencies.reconcileStateStore.reconcile(
        dependencies.userId,
        dependencies.clientId,
        pageCursor,
        parsedWriteIds.value
      );
      bumpLocalWriteId(dependencies);
    }

    if (!response.hasMore) {
      /**
       * Guardrail: when supported, finalize each pull cycle by explicitly
       * reconciling cursor + replica clocks with the server-side state table.
       * This keeps device-local state and durable server checkpoints aligned.
       */
      await reconcileWithTransportIfSupported(dependencies);
      return {
        pulledOperations,
        pullPages
      };
    }
  }
}

export async function runFlushLoop(
  dependencies: VfsSyncClientLoopDependencies
): Promise<VfsBackgroundSyncClientFlushResult> {
  let pushedOperations = 0;
  let staleRecoveryAttempts = 0;

  while (dependencies.pendingOperations.length > 0) {
    ensurePendingOccurredAtAfterCursor({
      pendingOperations: dependencies.pendingOperations,
      cursor: getCurrentCursorFromState({
        reconcileState: dependencies.reconcileStateStore.get(
          dependencies.userId,
          dependencies.clientId
        ),
        replayCursor: dependencies.replayStore.snapshot().cursor
      })
    });
    const currentBatch = dependencies.pendingOperations.slice();
    const pushResponse = await dependencies.transport.pushOperations({
      userId: dependencies.userId,
      clientId: dependencies.clientId,
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
        if (
          removePendingOperationById({
            pendingOperations: dependencies.pendingOperations,
            pendingOpIds: dependencies.pendingOpIds,
            opId: result.opId
          })
        ) {
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
        dependencies.emitGuardrailViolation({
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

      await pullUntilSettledLoop(dependencies);
      dependencies.writeNextLocalWriteId(
        rebasePendingOperations({
          pendingOperations: dependencies.pendingOperations,
          nextWriteId: nextWriteIdFromReconcileState({
            reconcileState: dependencies.reconcileStateStore.get(
              dependencies.userId,
              dependencies.clientId
            ),
            clientId: dependencies.clientId,
            nextLocalWriteId: dependencies.readNextLocalWriteId()
          }),
          cursor: getCurrentCursorFromState({
            reconcileState: dependencies.reconcileStateStore.get(
              dependencies.userId,
              dependencies.clientId
            ),
            replayCursor: dependencies.replayStore.snapshot().cursor
          }),
          nextLocalWriteId: dependencies.readNextLocalWriteId()
        })
      );
      continue;
    }

    staleRecoveryAttempts = 0;
  }

  const syncResult = await pullUntilSettledLoop(dependencies);
  return {
    pushedOperations,
    pulledOperations: syncResult.pulledOperations,
    pullPages: syncResult.pullPages
  };
}
