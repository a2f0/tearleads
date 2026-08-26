import type { DocumentsPersistence } from "@symcrypt/client-sdk";
import { base64ToBytes } from "@symcrypt/encoding";
import { getImportBlobMetadata, satisfiesVersionVector } from "@symcrypt/loro";

interface RecoveryPendingUpdate {
  id: string;
  sourceVersionVector?: string | null;
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
  return {
    pendingUpdateIds: input.pendingUpdates.flatMap((pendingUpdate) =>
      pendingUpdate.sourceVersionVector != null &&
      satisfiesVersionVector(
        input.documentVersion,
        pendingUpdate.sourceVersionVector,
      )
        ? [pendingUpdate.id]
        : [],
    ),
    tailIds: input.tail.flatMap((entry) => {
      try {
        const metadata = getImportBlobMetadata(base64ToBytes(entry.updateData));
        return satisfiesVersionVector(
          input.documentVersion,
          metadata.partialEndVersionVector,
        )
          ? [entry.id]
          : [];
      } catch {
        // Recovery replaces malformed local history with verified server
        // history, matching the production SQLite adapter.
        return [entry.id];
      }
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
  const coveredTailIds = new Set([
    ...input.checkpoint.coveredTailIds,
    ...coveredRecoveryState.tailIds,
  ]);
  input.history.checkpoint = {
    endVersionVector: input.checkpoint.endVersionVector,
    snapshot: input.checkpoint.snapshot,
  };
  input.history.tail = input.history.tail.filter(
    ({ id }) => !coveredTailIds.has(id),
  );
  return coveredRecoveryState.pendingUpdateIds;
}
