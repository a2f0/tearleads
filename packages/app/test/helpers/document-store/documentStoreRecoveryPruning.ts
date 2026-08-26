import type { DocumentsPersistence } from "@symcrypt/client-sdk";
import { base64ToBytes } from "@symcrypt/encoding";
import { getImportBlobMetadata, satisfiesVersionVector } from "@symcrypt/loro";

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

function findCoveredMemoryRecoveryLocalState(input: {
  documentVersion: string;
  pendingUpdates: readonly RecoveryPendingUpdate[];
  tail: readonly RecoveryHistoryTailEntry[];
}): { pendingUpdateIds: string[]; tailIds: string[] } {
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
  return {
    pendingUpdateIds: input.pendingUpdates.map(
      (pendingUpdate) => pendingUpdate.id,
    ),
    tailIds: input.tail.flatMap((entry) => {
      if (checkpointUpdateData.has(entry.updateData)) return [entry.id];
      try {
        const metadata = getImportBlobMetadata(base64ToBytes(entry.updateData));
        const covered = satisfiesVersionVector(
          input.documentVersion,
          metadata.partialEndVersionVector,
        );
        if (covered) return [entry.id];
      } catch {
        // Fall through: malformed history is not proven by the rebuild.
      }
      throw new Error(
        "Document recovery found unverified history tail before installation",
      );
    }),
  };
}

export function applyMemoryHistoryCheckpoint(input: {
  checkpoint: RecoveryHistoryCheckpoint;
  history: MutableRecoveryHistory;
  pendingUpdates: readonly RecoveryPendingUpdate[];
}): string[] {
  const coveredRecoveryState = input.checkpoint.pruneCoveredLocalState
    ? findCoveredMemoryRecoveryLocalState({
        documentVersion: input.checkpoint.endVersionVector,
        pendingUpdates: input.pendingUpdates,
        tail: input.history.tail,
      })
    : { pendingUpdateIds: [], tailIds: [] };
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
