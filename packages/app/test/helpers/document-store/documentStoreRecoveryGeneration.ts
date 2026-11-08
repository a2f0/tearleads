import type {
  DocumentRecord,
  DocumentsPersistence,
  PendingUpdateInsert,
  QueuedPendingUpdateRecord,
} from "@tearleads/client-sdk";

interface MemoryHistoryState {
  checkpoint: { endVersionVector: string; snapshot: string } | null;
  tail: { id: string; origin: "local" | "remote"; updateData: string }[];
}

type EnqueueOptions = Parameters<
  DocumentsPersistence["enqueuePendingUpdate"]
>[2];

type ReplaceInput = Parameters<
  DocumentsPersistence["replaceQueuedPendingUpdates"]
>[1];

export function memoryHistoryFor(
  historyByLocalId: Map<string, MemoryHistoryState>,
  localId: string,
): MemoryHistoryState {
  let history = historyByLocalId.get(localId);
  if (!history) {
    history = { checkpoint: null, tail: [] };
    historyByLocalId.set(localId, history);
  }
  return history;
}

export function memoryDocumentRecoveryGenerationMatches(
  current: DocumentRecord | null,
  expected: DocumentRecord,
): boolean {
  return (
    (current?.recoveryGeneration ?? 0) === (expected.recoveryGeneration ?? 0)
  );
}

export function canSaveMemoryDocument(
  current: DocumentRecord | null,
  next: DocumentRecord,
): boolean {
  return (current?.recoveryGeneration ?? 0) <= (next.recoveryGeneration ?? 0);
}

export function memoryDocumentWriteFenceMatches(
  document: DocumentRecord | null,
  localId: string,
  expectedDocumentId: string | null,
  expectedRecoveryGeneration: number,
): boolean {
  return (
    document?.id === localId &&
    document.documentId === expectedDocumentId &&
    (document.recoveryGeneration ?? 0) === expectedRecoveryGeneration
  );
}

export function enqueueMemoryPendingUpdate(input: {
  document: DocumentRecord | null;
  historyByLocalId: Map<string, MemoryHistoryState>;
  options: EnqueueOptions;
  pendingUpdate: PendingUpdateInsert;
  pendingUpdates: QueuedPendingUpdateRecord[];
}): { enqueued: boolean; pendingUpdates: QueuedPendingUpdateRecord[] } {
  if (
    input.options &&
    !memoryDocumentWriteFenceMatches(
      input.document,
      input.pendingUpdate.localId,
      input.options.expectedDocumentId,
      input.options.expectedRecoveryGeneration,
    )
  ) {
    return { enqueued: false, pendingUpdates: input.pendingUpdates };
  }

  const history = memoryHistoryFor(
    input.historyByLocalId,
    input.pendingUpdate.localId,
  );
  history.tail.push({
    id: crypto.randomUUID(),
    origin: "local",
    updateData: input.pendingUpdate.updateData,
  });
  return {
    enqueued: true,
    pendingUpdates: [
      ...input.pendingUpdates,
      {
        id: crypto.randomUUID(),
        origin: "local",
        partialEndVersionVector: input.pendingUpdate.partialEndVersionVector,
        partialStartVersionVector:
          input.pendingUpdate.partialStartVersionVector,
        sourceVersionVector: input.pendingUpdate.sourceVersionVector ?? null,
        updateData: input.pendingUpdate.updateData,
      },
    ],
  };
}

/**
 * The memory counterpart of `replaceQueuedPendingUpdates`: under the write
 * fence, replace a contiguous run of ordinary local queued rows (starting
 * with the first listed member) with the merged row at the first member's
 * position under a fresh id. Any failed check changes nothing. History tail
 * entries are kept separately here and already replay the same operations.
 */
export function replaceMemoryQueuedPendingUpdates(input: {
  document: DocumentRecord | null;
  pendingUpdates: QueuedPendingUpdateRecord[];
  replacement: ReplaceInput;
}): {
  pendingUpdates: QueuedPendingUpdateRecord[];
  updateId: string | null;
} {
  const { memberUpdateIds } = input.replacement;
  const first = input.pendingUpdates.findIndex(
    (row) => row.id === memberUpdateIds[0],
  );
  const run = input.pendingUpdates.slice(first, first + memberUpdateIds.length);
  const matches =
    memberUpdateIds.length >= 2 &&
    first >= 0 &&
    run.length === memberUpdateIds.length &&
    run.every(
      (row, index) =>
        row.id === memberUpdateIds[index] &&
        row.origin === "local" &&
        row.sourceVersionVector == null,
    ) &&
    memoryDocumentWriteFenceMatches(
      input.document,
      input.replacement.localId,
      input.replacement.expectedDocumentId,
      input.replacement.expectedRecoveryGeneration,
    );
  if (!matches) {
    return { pendingUpdates: input.pendingUpdates, updateId: null };
  }
  const updateId = crypto.randomUUID();
  const merged: QueuedPendingUpdateRecord = {
    ...input.replacement.merged,
    id: updateId,
    origin: "local",
    rekeyCount: input.replacement.rekeyCount,
    sourceVersionVector: null,
  };
  return {
    pendingUpdates: [
      ...input.pendingUpdates.slice(0, first),
      merged,
      ...input.pendingUpdates.slice(first + memberUpdateIds.length),
    ],
    updateId,
  };
}
