import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportFullHistorySnapshot,
  importSnapshot,
  importUpdates,
} from "@tearleads/loro";
import type { syncRemoteDocument } from "../../../workflows/documents";
import {
  advancePendingBaseVersion,
  coveredHistoryTailIds,
  type listPendingUpdates,
  persistDocument,
} from "./persistence";
import type { DocumentState, DocumentStoreState } from "./state";

/**
 * Shared machinery for reconstructing a full-history document from a verified
 * remote pull. Used by the rotation preflight (rotation.ts) and the
 * stale-heal history recovery (staleHealRecovery.ts): both pull the remote op
 * log, replay it into a fresh document alongside the durable local queue, and
 * install the rebuilt document — preserving op identity end to end.
 */

export function importPendingUpdates(
  document: DocumentState,
  pendingUpdates: Awaited<ReturnType<typeof listPendingUpdates>>,
): void {
  for (const pendingUpdate of pendingUpdates) {
    if (
      pendingUpdate.sourceVersionVector !== null &&
      pendingUpdate.sourceVersionVector !== undefined
    ) {
      importSnapshot(document, base64ToBytes(pendingUpdate.updateData));
    }
  }
  const ordinaryUpdates = pendingUpdates
    .filter(
      (pendingUpdate) =>
        pendingUpdate.sourceVersionVector === null ||
        pendingUpdate.sourceVersionVector === undefined,
    )
    .map((pendingUpdate) => base64ToBytes(pendingUpdate.updateData));
  if (ordinaryUpdates.length > 0) {
    importUpdates(document, ordinaryUpdates);
  }
}

export async function installRebuiltDocument(input: {
  currentRecord: NonNullable<DocumentStoreState["record"]>;
  rebuiltDoc: DocumentState;
  state: DocumentStoreState;
  synced: NonNullable<Awaited<ReturnType<typeof syncRemoteDocument>>>;
}): Promise<Uint8Array> {
  // Make the recovered history durable BEFORE publishing the newer shallow
  // record: a crash between the two would otherwise leave the record's
  // snapshot ahead of the checkpoint, and the next restore's lag fallback
  // would undo the whole recovery. Checkpoint-ahead is the safe direction —
  // the restore prefers it and the record catches up on the next persist.
  // The tail is captured BEFORE the export and each row's coverage is
  // proven against the rebuilt document, so an update appended concurrently
  // (or by another pane) that this rebuild does not contain survives for a
  // later compaction.
  const tailEntries =
    (await input.state.persistence.listHistoryTailEntries?.(
      input.state.runtime.infra.execSql,
      input.state.localId,
    )) ?? [];
  const fullHistorySnapshot = exportFullHistorySnapshot(input.rebuiltDoc);
  const coveredTailIds = coveredHistoryTailIds(
    tailEntries,
    encodeVersionVector(input.rebuiltDoc),
  );
  await input.state.persistence.replaceHistoryCheckpoint?.(
    input.state.runtime.infra.execSql,
    {
      coveredTailIds,
      localId: input.state.localId,
      snapshot: bytesToBase64(fullHistorySnapshot),
    },
  );
  const previousPendingBaseVersion = input.state.pendingBaseVersion;
  advancePendingBaseVersion(input.state, input.rebuiltDoc);
  try {
    await persistDocument(
      input.state,
      input.rebuiltDoc,
      {
        ...input.synced.persistedState,
        lastCommitLsn:
          input.synced.response.commitLsn ??
          input.currentRecord.lastCommitLsn ??
          null,
      },
      {
        acceptedPendingUpdateIds: input.synced.settledPendingUpdateIds,
        preserveSnapshotStructuredFields: input.state.pendingLocalWrites > 0,
        preserveSnapshotText: input.state.pendingLocalWrites > 0,
      },
    );
  } catch (error) {
    input.state.pendingBaseVersion = previousPendingBaseVersion;
    throw error;
  }
  input.state.doc = input.rebuiltDoc;
  input.state.writerProjection =
    input.synced.writerProjection ?? input.state.writerProjection;
  return fullHistorySnapshot;
}
