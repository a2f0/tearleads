import type { DocumentsPersistence } from "@symcrypt/client-sdk";
import { base64ToBytes } from "@symcrypt/encoding";
import {
  createDocument,
  exportFullHistoryIdentity,
  importSnapshot,
  satisfiesVersionVector,
  updateMatchesDocumentHistory,
} from "@symcrypt/loro";

interface RecoveryPendingUpdate {
  id: string;
  sourceVersionVector?: string | null;
  updateData: string;
}

interface RecoveryHistoryTailEntry {
  id: string;
  updateData: string;
}

interface MutableRecoveryHistory {
  checkpoint: { endVersionVector: string; snapshot: string } | null;
  tail: RecoveryHistoryTailEntry[];
}

type RecoveryHistoryCheckpoint = NonNullable<
  Parameters<
    DocumentsPersistence["commitDocumentMutation"]
  >[1]["historyCheckpoint"]
>;

async function findCoveredMemoryRecoveryLocalState(input: {
  recoverySnapshot: string;
  pendingUpdates: readonly RecoveryPendingUpdate[];
  tail: readonly RecoveryHistoryTailEntry[];
}): Promise<{ pendingUpdateIds: string[]; tailIds: string[] }> {
  if (
    input.pendingUpdates.some(
      (pendingUpdate) => pendingUpdate.sourceVersionVector == null,
    )
  ) {
    throw new Error(
      "Document recovery found unproven pending updates before installation",
    );
  }
  const checkpointUpdateData = new Set(
    input.pendingUpdates.map((pendingUpdate) => pendingUpdate.updateData),
  );
  const recoveredDocument = await createDocument("memory-recovery-tail-gate");
  try {
    importSnapshot(recoveredDocument, base64ToBytes(input.recoverySnapshot));
    return {
      pendingUpdateIds: input.pendingUpdates.map(
        (pendingUpdate) => pendingUpdate.id,
      ),
      tailIds: input.tail.flatMap((entry) => {
        if (checkpointUpdateData.has(entry.updateData)) return [entry.id];
        try {
          if (
            updateMatchesDocumentHistory(
              recoveredDocument,
              base64ToBytes(entry.updateData),
            )
          ) {
            return [entry.id];
          }
        } catch {
          // Fall through: malformed history is not proven by the rebuild.
        }
        throw new Error(
          "Document recovery found unverified history tail before installation",
        );
      }),
    };
  } finally {
    recoveredDocument.free();
  }
}

async function recoveryCheckpointCanReplace(input: {
  candidate: RecoveryHistoryCheckpoint;
  stored: MutableRecoveryHistory["checkpoint"];
}): Promise<boolean> {
  if (!input.stored) return true;
  if (
    !satisfiesVersionVector(
      input.candidate.endVersionVector,
      input.stored.endVersionVector,
    )
  ) {
    return false;
  }
  if (input.candidate.snapshot === input.stored.snapshot) return true;

  const [candidateDocument, storedDocument] = await Promise.all([
    createDocument("memory-checkpoint-candidate-history-gate"),
    createDocument("memory-checkpoint-stored-history-gate"),
  ]);
  try {
    importSnapshot(candidateDocument, base64ToBytes(input.candidate.snapshot));
    importSnapshot(storedDocument, base64ToBytes(input.stored.snapshot));
    return (
      exportFullHistoryIdentity(
        candidateDocument,
        input.stored.endVersionVector,
      ) === exportFullHistoryIdentity(storedDocument)
    );
  } finally {
    candidateDocument.free();
    storedDocument.free();
  }
}

export async function applyMemoryHistoryCheckpoint(input: {
  checkpoint: RecoveryHistoryCheckpoint;
  history: MutableRecoveryHistory;
  pendingUpdates: readonly RecoveryPendingUpdate[];
}): Promise<string[]> {
  const coveredRecoveryState = input.checkpoint.pruneCoveredLocalState
    ? await findCoveredMemoryRecoveryLocalState({
        recoverySnapshot: input.checkpoint.snapshot,
        pendingUpdates: input.pendingUpdates,
        tail: input.history.tail,
      })
    : { pendingUpdateIds: [], tailIds: [] };
  if (
    !(await recoveryCheckpointCanReplace({
      candidate: input.checkpoint,
      stored: input.history.checkpoint,
    }))
  ) {
    if (input.checkpoint.pruneCoveredLocalState) {
      throw new Error(
        "Document recovery checkpoint was superseded before installation",
      );
    }
    return [];
  }
  const coveredTailIds = new Set(
    input.checkpoint.pruneCoveredLocalState
      ? coveredRecoveryState.tailIds
      : input.checkpoint.coveredTailIds,
  );
  input.history.checkpoint = {
    endVersionVector: input.checkpoint.endVersionVector,
    snapshot: input.checkpoint.snapshot,
  };
  input.history.tail = input.history.tail.filter(
    ({ id }) => !coveredTailIds.has(id),
  );
  return coveredRecoveryState.pendingUpdateIds;
}
