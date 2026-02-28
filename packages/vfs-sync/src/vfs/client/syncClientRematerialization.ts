import type { InMemoryVfsContainerClockStore } from '../protocol/sync-container-clocks.js';
import type { VfsCrdtOperation } from '../protocol/sync-crdt.js';
import type { InMemoryVfsCrdtFeedReplayStore } from '../protocol/sync-crdt-feed-replay.js';
import type { InMemoryVfsCrdtClientStateStore } from '../protocol/sync-crdt-reconcile.js';
import { compareVfsSyncCursorOrder } from '../protocol/sync-reconcile.js';
import { bumpLocalWriteIdFromReconcileState } from './sync-client-pending-operations.js';
import {
  normalizePersistedContainerClocks,
  normalizePersistedReconcileState,
  normalizePersistedReplaySnapshot
} from './sync-client-persistence-normalizers.js';
import type {
  VfsBackgroundSyncClientRematerializedState,
  VfsCrdtRematerializationRequiredError,
  VfsRematerializationRequiredHandler
} from './sync-client-utils.js';

interface RematerializationStores {
  replayStore: InMemoryVfsCrdtFeedReplayStore;
  reconcileStateStore: InMemoryVfsCrdtClientStateStore;
  containerClockStore: InMemoryVfsContainerClockStore;
}

export async function runWithRematerializationRecovery<T>(input: {
  maxAttempts: number;
  execute: () => Promise<T>;
  rematerialize: (
    attempt: number,
    error: VfsCrdtRematerializationRequiredError
  ) => Promise<void>;
}): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await input.execute();
    } catch (error) {
      if (!isRematerializationError(error) || attempt >= input.maxAttempts) {
        throw error;
      }

      attempt += 1;
      await input.rematerialize(attempt, error);
    }
  }
}

function isRematerializationError(
  value: unknown
): value is VfsCrdtRematerializationRequiredError {
  return (
    value instanceof Error &&
    value.name === 'VfsCrdtRematerializationRequiredError'
  );
}

function applyRematerializedState(input: {
  userId: string;
  clientId: string;
  stores: RematerializationStores;
  pendingOperations: VfsCrdtOperation[];
  nextLocalWriteId: number;
  state: VfsBackgroundSyncClientRematerializedState | null | undefined;
}): number {
  const state = input.state ?? {
    replaySnapshot: { acl: [], links: [], cursor: null },
    reconcileState: null,
    containerClocks: []
  };
  const replaySnapshot = normalizePersistedReplaySnapshot(state.replaySnapshot);
  const reconcileState = normalizePersistedReconcileState(state.reconcileState);
  const containerClocks = normalizePersistedContainerClocks(
    state.containerClocks
  );

  if (
    replaySnapshot.cursor &&
    reconcileState &&
    compareVfsSyncCursorOrder(reconcileState.cursor, replaySnapshot.cursor) < 0
  ) {
    throw new Error(
      'rematerialized reconcile cursor regressed rematerialized replay cursor'
    );
  }

  const effectiveCursor = reconcileState?.cursor ?? replaySnapshot.cursor;
  if (containerClocks.length > 0 && !effectiveCursor) {
    throw new Error(
      'rematerialized container clocks require replay or reconcile cursor'
    );
  }
  if (effectiveCursor) {
    for (let index = 0; index < containerClocks.length; index++) {
      const clock = containerClocks[index];
      if (
        clock &&
        compareVfsSyncCursorOrder(
          {
            changedAt: clock.changedAt,
            changeId: clock.changeId
          },
          effectiveCursor
        ) > 0
      ) {
        throw new Error(
          `rematerialized containerClocks[${index}] is ahead of rematerialized cursor`
        );
      }
    }
  }

  input.stores.replayStore.replaceSnapshot(replaySnapshot);
  input.stores.containerClockStore.replaceSnapshot(containerClocks);
  input.stores.reconcileStateStore.clear(input.userId, input.clientId);
  if (reconcileState) {
    input.stores.reconcileStateStore.reconcile(
      input.userId,
      input.clientId,
      reconcileState.cursor,
      reconcileState.lastReconciledWriteIds
    );
  }

  let maxPendingWriteId = 0;
  for (const operation of input.pendingOperations) {
    maxPendingWriteId = Math.max(maxPendingWriteId, operation.writeId);
  }

  return bumpLocalWriteIdFromReconcileState({
    reconcileState: input.stores.reconcileStateStore.get(
      input.userId,
      input.clientId
    ),
    clientId: input.clientId,
    nextLocalWriteId: Math.max(input.nextLocalWriteId, maxPendingWriteId + 1)
  });
}

export async function rematerializeClientState(input: {
  userId: string;
  clientId: string;
  attempt: number;
  error: VfsCrdtRematerializationRequiredError;
  stores: RematerializationStores;
  pendingOperations: VfsCrdtOperation[];
  nextLocalWriteId: number;
  onRematerializationRequired: VfsRematerializationRequiredHandler | null;
}): Promise<number> {
  const rematerializedState = input.onRematerializationRequired
    ? ((await input.onRematerializationRequired({
        userId: input.userId,
        clientId: input.clientId,
        error: input.error,
        attempt: input.attempt
      })) ?? null)
    : null;

  return applyRematerializedState({
    userId: input.userId,
    clientId: input.clientId,
    stores: input.stores,
    pendingOperations: input.pendingOperations,
    nextLocalWriteId: input.nextLocalWriteId,
    state: rematerializedState
  });
}
