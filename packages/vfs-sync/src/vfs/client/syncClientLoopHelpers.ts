import {
  type InMemoryVfsCrdtClientStateStore,
  parseVfsCrdtLastReconciledWriteIds
} from '../protocol/sync-crdt-reconcile.js';
import type { VfsSyncCursor } from '../protocol/sync-cursor.js';
import { compareVfsSyncCursorOrder } from '../protocol/sync-reconcile.js';
import { bumpLocalWriteIdFromReconcileState } from './sync-client-pending-operations.js';
import type {
  VfsCrdtSyncTransport,
  VfsSyncGuardrailViolation
} from './sync-client-utils.js';
import {
  assertNonRegressingLastWriteIds,
  cloneCursor,
  normalizeCursor,
  normalizeRequiredString
} from './sync-client-utils.js';

interface BumpLocalWriteIdDependencies {
  userId: string;
  clientId: string;
  reconcileStateStore: InMemoryVfsCrdtClientStateStore;
  readNextLocalWriteId: () => number;
  writeNextLocalWriteId: (value: number) => void;
}

export function bumpLocalWriteId(
  dependencies: BumpLocalWriteIdDependencies
): void {
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

function toPullItemCursor(item: {
  opId: unknown;
  occurredAt: unknown;
}): VfsSyncCursor | null {
  const changeId = normalizeRequiredString(item.opId);
  if (!changeId) {
    return null;
  }

  if (typeof item.occurredAt !== 'string') {
    return null;
  }

  const occurredAtMs = Date.parse(item.occurredAt);
  if (!Number.isFinite(occurredAtMs)) {
    return null;
  }

  return {
    changedAt: new Date(occurredAtMs).toISOString(),
    changeId
  };
}

export function filterPullItemsNewerThanCursor<
  TItem extends { opId: unknown; occurredAt: unknown }
>(input: {
  items: TItem[];
  cursorBeforePull: VfsSyncCursor | null;
  emitGuardrailViolation: (violation: VfsSyncGuardrailViolation) => void;
}): TItem[] {
  if (!input.cursorBeforePull) {
    return input.items;
  }

  let droppedItems = 0;
  const filteredItems: TItem[] = [];
  for (const item of input.items) {
    const itemCursor = toPullItemCursor(item);
    if (
      itemCursor &&
      compareVfsSyncCursorOrder(itemCursor, input.cursorBeforePull) <= 0
    ) {
      droppedItems += 1;
      continue;
    }
    filteredItems.push(item);
  }

  if (droppedItems > 0) {
    input.emitGuardrailViolation({
      code: 'pullPageInvariantViolation',
      stage: 'pull',
      message: 'pull response included stale items at or before local cursor',
      details: {
        droppedItems,
        previousChangedAt: input.cursorBeforePull.changedAt,
        previousChangeId: input.cursorBeforePull.changeId
      }
    });
  }

  return filteredItems;
}

interface ReconcileWithTransportIfSupportedDependencies
  extends BumpLocalWriteIdDependencies {
  transport: VfsCrdtSyncTransport;
  emitGuardrailViolation: (violation: VfsSyncGuardrailViolation) => void;
}

export async function reconcileWithTransportIfSupported(
  dependencies: ReconcileWithTransportIfSupportedDependencies
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
