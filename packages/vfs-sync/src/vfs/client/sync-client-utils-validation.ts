import type { VfsCrdtOperation } from '../protocol/sync-crdt.js';
import type { VfsCrdtLastReconciledWriteIds } from '../protocol/sync-crdt-reconcile.js';
import {
  type VfsCrdtSyncPushResult,
  type VfsCrdtSyncPushResponse,
  type VfsCrdtSyncPushStatus
} from './sync-client-utils-types.js';

export function isPushStatus(value: unknown): value is VfsCrdtSyncPushStatus {
  return (
    value === 'applied' ||
    value === 'alreadyApplied' ||
    value === 'staleWriteId' ||
    value === 'outdatedOp' ||
    value === 'invalidOp' ||
    value === 'encryptedEnvelopeUnsupported'
  );
}

export function validatePushResponse(
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

export function assertNonRegressingLastWriteIds(
  observedLastWriteIds: Map<string, number>,
  incomingLastWriteIds: VfsCrdtLastReconciledWriteIds,
  onRegression?:
    | ((input: {
        replicaId: string;
        previousWriteId: number;
        incomingWriteId: number;
      }) => void)
    | null
): void {
  for (const [replicaId, writeId] of Object.entries(incomingLastWriteIds)) {
    const previousWriteId = observedLastWriteIds.get(replicaId) ?? 0;
    if (writeId < previousWriteId) {
      onRegression?.({
        replicaId,
        previousWriteId,
        incomingWriteId: writeId
      });
      throw new Error(
        `transport regressed lastReconciledWriteIds for replica ${replicaId}`
      );
    }

    if (writeId > previousWriteId) {
      observedLastWriteIds.set(replicaId, writeId);
    }
  }
}
