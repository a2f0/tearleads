import type {
  DocumentRecord,
  DocumentsPersistence,
  PendingUpdateInsert,
  PendingUpdateRecord,
} from "@symcrypt/client-sdk";

interface MemoryHistoryState {
  checkpoint: { endVersionVector: string; snapshot: string } | null;
  tail: { id: string; origin: "local" | "remote"; updateData: string }[];
}

type EnqueueOptions = Parameters<
  DocumentsPersistence["enqueuePendingUpdate"]
>[2];

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
  pendingUpdates: PendingUpdateRecord[];
}): { enqueued: boolean; pendingUpdates: PendingUpdateRecord[] } {
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
        partialEndVersionVector: input.pendingUpdate.partialEndVersionVector,
        partialStartVersionVector:
          input.pendingUpdate.partialStartVersionVector,
        sourceVersionVector: input.pendingUpdate.sourceVersionVector ?? null,
        updateData: input.pendingUpdate.updateData,
      },
    ],
  };
}
