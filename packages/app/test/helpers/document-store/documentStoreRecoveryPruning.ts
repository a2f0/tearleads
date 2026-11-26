import type { DocumentsPersistence } from "@tearleads/client-sdk";
import { base64ToBytes } from "@tearleads/encoding";
import {
  createDocument,
  exportFullHistoryIdentity,
  importSnapshot,
  satisfiesVersionVector,
  updateMatchesDocumentHistory,
} from "@tearleads/loro";

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

/**
 * The tail entries a recovery snapshot covers. A queued update is local work
 * no server history can stand for, so any one refuses the install.
 */
async function findCoveredMemoryRecoveryTailIds(input: {
  recoverySnapshot: string;
  pendingUpdateCount: number;
  tail: readonly RecoveryHistoryTailEntry[];
}): Promise<string[]> {
  if (input.pendingUpdateCount > 0) {
    throw new Error(
      "Document recovery found unproven pending updates before installation",
    );
  }
  const recoveredDocument = await createDocument("memory-recovery-tail-gate");
  try {
    importSnapshot(recoveredDocument, base64ToBytes(input.recoverySnapshot));
    return input.tail.flatMap((entry) => {
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
    });
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
  pendingUpdateCount: number;
}): Promise<void> {
  const recoveryCoveredTailIds = input.checkpoint.pruneCoveredLocalState
    ? await findCoveredMemoryRecoveryTailIds({
        recoverySnapshot: input.checkpoint.snapshot,
        pendingUpdateCount: input.pendingUpdateCount,
        tail: input.history.tail,
      })
    : [];
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
    return;
  }
  const coveredTailIds = new Set(
    input.checkpoint.pruneCoveredLocalState
      ? recoveryCoveredTailIds
      : input.checkpoint.coveredTailIds,
  );
  input.history.checkpoint = {
    endVersionVector: input.checkpoint.endVersionVector,
    snapshot: input.checkpoint.snapshot,
  };
  input.history.tail = input.history.tail.filter(
    ({ id }) => !coveredTailIds.has(id),
  );
}
