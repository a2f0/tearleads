import { cloneCursor } from './sync-client-utils.js';
import type { VfsCrdtOperation } from '../protocol/sync-crdt.js';
import type { VfsCrdtClientReconcileState } from '../protocol/sync-crdt-reconcile.js';
import type { VfsSyncCursor } from '../protocol/sync-cursor.js';

interface GetCurrentCursorFromStateParams {
  reconcileState: VfsCrdtClientReconcileState | null;
  replayCursor: VfsSyncCursor | null;
}

export function getCurrentCursorFromState({
  reconcileState,
  replayCursor
}: GetCurrentCursorFromStateParams): VfsSyncCursor | null {
  if (reconcileState) {
    return cloneCursor(reconcileState.cursor);
  }

  return replayCursor ? cloneCursor(replayCursor) : null;
}

interface LocalWriteIdFromReconcileStateParams {
  reconcileState: VfsCrdtClientReconcileState | null;
  clientId: string;
  nextLocalWriteId: number;
}

export function bumpLocalWriteIdFromReconcileState({
  reconcileState,
  clientId,
  nextLocalWriteId
}: LocalWriteIdFromReconcileStateParams): number {
  if (!reconcileState) {
    return nextLocalWriteId;
  }

  const replicatedWriteId = reconcileState.lastReconciledWriteIds[clientId];
  if (typeof replicatedWriteId !== 'number') {
    return nextLocalWriteId;
  }

  return replicatedWriteId + 1 > nextLocalWriteId
    ? replicatedWriteId + 1
    : nextLocalWriteId;
}

export function nextWriteIdFromReconcileState({
  reconcileState,
  clientId,
  nextLocalWriteId
}: LocalWriteIdFromReconcileStateParams): number {
  if (!reconcileState) {
    return nextLocalWriteId;
  }

  const replicatedWriteId = reconcileState.lastReconciledWriteIds[clientId];
  if (
    typeof replicatedWriteId !== 'number' ||
    !Number.isFinite(replicatedWriteId) ||
    !Number.isInteger(replicatedWriteId) ||
    replicatedWriteId < 0
  ) {
    return nextLocalWriteId;
  }

  return Math.max(nextLocalWriteId, replicatedWriteId + 1);
}

interface RebasePendingOperationsParams {
  pendingOperations: VfsCrdtOperation[];
  nextWriteId: number;
  cursor: VfsSyncCursor | null;
  nextLocalWriteId: number;
}

export function rebasePendingOperations({
  pendingOperations,
  nextWriteId,
  cursor,
  nextLocalWriteId
}: RebasePendingOperationsParams): number {
  let writeId = Math.max(1, nextWriteId);
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
  for (const operation of pendingOperations) {
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

  return writeId > nextLocalWriteId ? writeId : nextLocalWriteId;
}

interface EnsurePendingOccurredAtAfterCursorParams {
  pendingOperations: VfsCrdtOperation[];
  cursor: VfsSyncCursor | null;
}

export function ensurePendingOccurredAtAfterCursor({
  pendingOperations,
  cursor
}: EnsurePendingOccurredAtAfterCursorParams): void {
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
  for (const operation of pendingOperations) {
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

interface RemovePendingOperationByIdParams {
  pendingOperations: VfsCrdtOperation[];
  pendingOpIds: Set<string>;
  opId: string;
}

export function removePendingOperationById({
  pendingOperations,
  pendingOpIds,
  opId
}: RemovePendingOperationByIdParams): boolean {
  const index = pendingOperations.findIndex(
    (operation) => operation.opId === opId
  );
  if (index < 0) {
    return false;
  }

  pendingOperations.splice(index, 1);
  pendingOpIds.delete(opId);
  return true;
}
