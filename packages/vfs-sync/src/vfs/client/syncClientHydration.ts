import type { VfsContainerClockEntry } from '../protocol/sync-container-clocks.js';
import type { VfsCrdtOperation } from '../protocol/sync-crdt.js';
import type { VfsCrdtFeedReplaySnapshot } from '../protocol/sync-crdt-feed-replay.js';
import type { VfsCrdtClientReconcileState } from '../protocol/sync-crdt-reconcile.js';
import { compareVfsSyncCursorOrder } from '../protocol/sync-reconcile.js';
import {
  normalizePersistedContainerClocks,
  normalizePersistedPendingOperation,
  normalizePersistedReconcileState,
  normalizePersistedReplaySnapshot
} from './sync-client-persistence-normalizers.js';
import type { VfsBackgroundSyncClientPersistedState } from './sync-client-utils.js';

interface ValidatedHydrationState {
  replaySnapshot: VfsCrdtFeedReplaySnapshot;
  reconcileState: VfsCrdtClientReconcileState | null;
  containerClocks: VfsContainerClockEntry[];
  pendingOperations: VfsCrdtOperation[];
  maxPendingWriteId: number;
}

export function validateAndNormalizeHydrationState(
  state: VfsBackgroundSyncClientPersistedState,
  clientId: string
): ValidatedHydrationState {
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
      clientId
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

  return {
    replaySnapshot: normalizedReplaySnapshot,
    reconcileState: normalizedReconcileState,
    containerClocks: normalizedContainerClocks,
    pendingOperations: normalizedPendingOperations,
    maxPendingWriteId
  };
}
