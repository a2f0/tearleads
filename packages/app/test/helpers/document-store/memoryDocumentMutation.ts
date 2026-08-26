import type {
  DocumentRecord,
  DocumentsPersistence,
  LocalAttachmentRecord,
  PendingAttachmentRecord,
  PendingUpdateRecord,
} from "@symcrypt/client-sdk";
import { applyMemoryHistoryCheckpoint } from "./documentStoreRecoveryPruning";
import { applyMemoryAttachmentRemoval } from "./documentStoreSyncPersistenceState";

interface MemoryDocumentState {
  document: DocumentRecord | null;
  localAttachments: LocalAttachmentRecord[];
  pendingAttachments: PendingAttachmentRecord[];
  pendingUpdates: PendingUpdateRecord[];
}

interface MemoryHistoryState {
  checkpoint: { endVersionVector: string; snapshot: string } | null;
  tail: { id: string; origin: "local" | "remote"; updateData: string }[];
}

type CommitMutation = Parameters<
  DocumentsPersistence["commitDocumentMutation"]
>[1];
type SaveClientProjection = Parameters<
  DocumentsPersistence["commitDocumentMutation"]
>[2];

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mapsEqual(
  left: ReadonlyMap<string, MemoryHistoryState>,
  right: ReadonlyMap<string, MemoryHistoryState>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (!valuesEqual(value, right.get(key))) return false;
  }
  return true;
}

function replaceMap(
  target: Map<string, MemoryHistoryState>,
  source: ReadonlyMap<string, MemoryHistoryState>,
): void {
  target.clear();
  for (const [key, value] of source) target.set(key, value);
}

function stageAttachments(
  state: MemoryDocumentState,
  mutation: CommitMutation,
): void {
  if (mutation.attachmentRemoval) {
    ({
      localAttachments: state.localAttachments,
      pendingAttachments: state.pendingAttachments,
    } = applyMemoryAttachmentRemoval({
      localAttachments: state.localAttachments,
      pendingAttachments: state.pendingAttachments,
      removal: mutation.attachmentRemoval,
    }));
  }
  if (!mutation.attachmentStaging) return;
  const pendingSlotIds = new Set(
    mutation.attachmentStaging.pendingAttachments.map(({ slotId }) => slotId),
  );
  const localSlotIds = new Set(
    mutation.attachmentStaging.localAttachments.map(({ slotId }) => slotId),
  );
  state.pendingAttachments = [
    ...state.pendingAttachments.filter(
      ({ slotId }) => !pendingSlotIds.has(slotId),
    ),
    ...mutation.attachmentStaging.pendingAttachments,
  ];
  state.localAttachments = [
    ...state.localAttachments.filter(({ slotId }) => !localSlotIds.has(slotId)),
    ...mutation.attachmentStaging.localAttachments,
  ];
}

async function stageMutation(input: {
  historyByLocalId: Map<string, MemoryHistoryState>;
  mutation: CommitMutation;
  state: MemoryDocumentState;
}): Promise<void> {
  stageAttachments(input.state, input.mutation);
  const history = input.historyByLocalId.get(input.mutation.document.id) ?? {
    checkpoint: null,
    tail: [],
  };
  const coveredRecoveryPendingUpdateIds = input.mutation.historyCheckpoint
    ? await applyMemoryHistoryCheckpoint({
        checkpoint: input.mutation.historyCheckpoint,
        history,
        pendingUpdates: input.state.pendingUpdates,
      })
    : [];
  for (const updateData of input.mutation.historyUpdates ?? []) {
    history.tail.push({
      id: crypto.randomUUID(),
      origin: input.mutation.historyUpdateOrigin ?? "local",
      updateData,
    });
  }
  if (input.mutation.pendingUpdate) {
    input.state.pendingUpdates.push({
      id: crypto.randomUUID(),
      ...input.mutation.pendingUpdate,
    });
    history.tail.push({
      id: crypto.randomUUID(),
      origin: "local",
      updateData: input.mutation.pendingUpdate.updateData,
    });
  }
  input.historyByLocalId.set(input.mutation.document.id, history);
  const acceptedIds = new Set([
    ...input.mutation.acceptedPendingUpdateIds,
    ...coveredRecoveryPendingUpdateIds,
  ]);
  input.state.pendingUpdates = input.state.pendingUpdates.filter(
    ({ id }) => !acceptedIds.has(id),
  );
  input.state.document = input.mutation.document;
}

export async function commitMemoryDocumentMutation(input: {
  execSql: Parameters<DocumentsPersistence["commitDocumentMutation"]>[0];
  getState: () => MemoryDocumentState;
  historyByLocalId: Map<string, MemoryHistoryState>;
  mutation: CommitMutation;
  replaceState: (state: MemoryDocumentState) => void;
  saveClientProjection: SaveClientProjection;
}) {
  const baselineState = structuredClone(input.getState());
  if (input.mutation.stillCurrent && !input.mutation.stillCurrent()) {
    return { committed: false as const, currentRecord: baselineState.document };
  }
  if (!valuesEqual(baselineState.document, input.mutation.expectedRecord)) {
    return { committed: false as const, currentRecord: baselineState.document };
  }
  const baselineHistory = structuredClone(input.historyByLocalId);
  const stagedState = structuredClone(baselineState);
  const stagedHistory = structuredClone(baselineHistory);
  await stageMutation({
    historyByLocalId: stagedHistory,
    mutation: input.mutation,
    state: stagedState,
  });
  const updatedAt = input.mutation.updatedAt ?? "2026-04-06T00:00:00.000Z";
  await input.saveClientProjection(input.execSql, updatedAt);

  const currentState = input.getState();
  if (
    (input.mutation.stillCurrent && !input.mutation.stillCurrent()) ||
    !valuesEqual(currentState, baselineState) ||
    !mapsEqual(input.historyByLocalId, baselineHistory)
  ) {
    return { committed: false as const, currentRecord: currentState.document };
  }
  input.replaceState(stagedState);
  replaceMap(input.historyByLocalId, stagedHistory);
  return { committed: true as const, updatedAt };
}
