import type { InMemoryVfsContainerClockStore } from '../protocol/sync-container-clocks.js';
import type { VfsCrdtOperation } from '../protocol/sync-crdt.js';
import type { InMemoryVfsCrdtFeedReplayStore } from '../protocol/sync-crdt-feed-replay.js';
import {
  type InMemoryVfsCrdtClientStateStore,
  parseVfsCrdtLastReconciledWriteIds
} from '../protocol/sync-crdt-reconcile.js';
import type { VfsSyncCursor } from '../protocol/sync-cursor.js';
import { compareVfsSyncCursorOrder } from '../protocol/sync-reconcile.js';
import {
  ensurePendingOccurredAtAfterCursor,
  getCurrentCursorFromState,
  nextWriteIdFromReconcileState,
  rebasePendingOperations,
  removePendingOperationById
} from './sync-client-pending-operations.js';
import type {
  VfsAclOperationSigner,
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
  normalizeRequiredString,
  VfsCrdtRematerializationRequiredError,
  VfsCrdtSyncPushRejectedError,
  validatePushResponse
} from './sync-client-utils.js';
import { signPushOperations } from './syncClientAclSigning.js';
import type { VfsAclTofuKeyStore } from './syncClientAclKeyStore.js';
import type { VfsAclVerificationHandler } from './syncClientAclVerification.js';
import { verifyPullAclSignatures } from './syncClientAclVerification.js';
import {
  bumpLocalWriteId,
  filterPullItemsNewerThanCursor,
  reconcileWithTransportIfSupported
} from './syncClientLoopHelpers.js';

interface VfsSyncClientLoopDependencies {
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
  signAclOperation: VfsAclOperationSigner | null;
  verifyAclSignaturesOnPull: boolean;
  tofuKeyStore: VfsAclTofuKeyStore | null;
  onAclVerificationFailure: VfsAclVerificationHandler | null;
  emitGuardrailViolation: (violation: VfsSyncGuardrailViolation) => void;
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
    let response: Awaited<ReturnType<VfsCrdtSyncTransport['pullOperations']>>;
    try {
      response = await dependencies.transport.pullOperations({
        userId: dependencies.userId,
        clientId: dependencies.clientId,
        cursor: cursorBeforePull,
        limit: dependencies.pullLimit
      });
    } catch (error) {
      if (error instanceof VfsCrdtRematerializationRequiredError) {
        dependencies.emitGuardrailViolation({
          code: 'pullRematerializationRequired',
          stage: 'pull',
          message: 'pull requires re-materialization from canonical state',
          details: {
            requestedCursor: error.requestedCursor,
            oldestAvailableCursor: error.oldestAvailableCursor
          }
        });
      }
      throw error;
    }
    pullPages += 1;

    const forwardItems = filterPullItemsNewerThanCursor({
      items: response.items,
      cursorBeforePull,
      emitGuardrailViolation: dependencies.emitGuardrailViolation
    });

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

    if (dependencies.verifyAclSignaturesOnPull && forwardItems.length > 0) {
      const failureCount = verifyPullAclSignatures({
        items: forwardItems,
        tofuKeyStore: dependencies.tofuKeyStore,
        onVerificationFailure: dependencies.onAclVerificationFailure
      });
      if (failureCount > 0) {
        dependencies.emitGuardrailViolation({
          code: 'pullAclSignatureVerificationFailure',
          stage: 'pull',
          message: `${failureCount} ACL operation(s) failed client-side signature verification`,
          details: {
            failureCount
          }
        });
      }
    }

    const pullItemsApplied = forwardItems.length > 0;
    let pageCursor: VfsSyncCursor | null = null;
    if (response.items.length > 0) {
      /**
       * Guardrail: a single pull cycle must never replay an opId across page
       * boundaries. Replay indicates a broken cursor contract and can cause
       * non-deterministic reapplication or stalled pagination.
       */
      for (const item of forwardItems) {
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

    let effectivePageCursor = pageCursor;
    if (
      cursorBeforePull &&
      pageCursor &&
      compareVfsSyncCursorOrder(pageCursor, cursorBeforePull) < 0
    ) {
      if (forwardItems.length === 0) {
        dependencies.emitGuardrailViolation({
          code: 'pullPageInvariantViolation',
          stage: 'pull',
          message:
            'pull response regressed cursor without newer items; preserving local cursor boundary',
          details: {
            previousChangedAt: cursorBeforePull.changedAt,
            previousChangeId: cursorBeforePull.changeId,
            incomingChangedAt: pageCursor.changedAt,
            incomingChangeId: pageCursor.changeId
          }
        });
        effectivePageCursor = cloneCursor(cursorBeforePull);
      } else {
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
    }

    if (response.hasMore && forwardItems.length === 0) {
      const rematerializationDetails = cursorBeforePull
        ? {
            previousChangedAt: cursorBeforePull.changedAt,
            previousChangeId: cursorBeforePull.changeId
          }
        : null;
      dependencies.emitGuardrailViolation({
        code: 'pullRematerializationRequired',
        stage: 'pull',
        message:
          'pull response could not advance beyond local cursor while reporting hasMore',
        ...(rematerializationDetails
          ? { details: rematerializationDetails }
          : {})
      });
      throw new VfsCrdtRematerializationRequiredError({
        message: 'CRDT pull page did not contain items newer than local cursor'
      });
    }

    if (pullItemsApplied) {
      dependencies.replayStore.applyPage(forwardItems);
      dependencies.containerClockStore.applyFeedItems(forwardItems);
      pulledOperations += forwardItems.length;
    }

    const replayCursorAfterPull = dependencies.replayStore.snapshot().cursor;
    if (
      replayCursorAfterPull &&
      (!effectivePageCursor ||
        compareVfsSyncCursorOrder(effectivePageCursor, replayCursorAfterPull) <
          0)
    ) {
      dependencies.emitGuardrailViolation({
        code: 'pullPageInvariantViolation',
        stage: 'pull',
        message:
          'pull response cursor boundary lagged applied replay cursor; advancing reconcile boundary',
        details: {
          replayChangedAt: replayCursorAfterPull.changedAt,
          replayChangeId: replayCursorAfterPull.changeId,
          boundaryChangedAt: effectivePageCursor?.changedAt ?? null,
          boundaryChangeId: effectivePageCursor?.changeId ?? null
        }
      });
      effectivePageCursor = cloneCursor(replayCursorAfterPull);
    }

    if (effectivePageCursor) {
      dependencies.reconcileStateStore.reconcile(
        dependencies.userId,
        dependencies.clientId,
        effectivePageCursor,
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
    const currentBatch = await signPushOperations({
      operations: dependencies.pendingOperations.slice(),
      signAclOperation: dependencies.signAclOperation
    });
    const pushResponse = await dependencies.transport.pushOperations({
      userId: dependencies.userId,
      clientId: dependencies.clientId,
      operations: currentBatch
    });

    const pushResults = validatePushResponse(currentBatch, pushResponse);
    const rejectedResults = pushResults.filter(
      (result) =>
        result.status === 'staleWriteId' ||
        result.status === 'invalidOp' ||
        result.status === 'aclDenied' ||
        result.status === 'encryptedEnvelopeUnsupported'
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

    const invalidResults: typeof rejectedResults = [];
    const staleResults: typeof rejectedResults = [];
    for (const result of rejectedResults) {
      if (
        result.status === 'invalidOp' ||
        result.status === 'aclDenied' ||
        result.status === 'encryptedEnvelopeUnsupported'
      ) {
        invalidResults.push(result);
        continue;
      }
      if (result.status === 'staleWriteId') {
        staleResults.push(result);
      }
    }

    if (invalidResults.length > 0) {
      throw new VfsCrdtSyncPushRejectedError(invalidResults);
    }

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
