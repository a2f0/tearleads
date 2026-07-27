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
 * Machinery for reconstructing a full-history document from a verified remote
 * pull. Used by the rotation preflight (rotation.ts): it pulls the remote op
 * log, replays it into a fresh document alongside the durable local queue,
 * and installs the rebuilt document — preserving op identity end to end.
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
  // Make the recovered history durable BEFORE publishing the newer record: a
  // crash between the two would otherwise leave the record's content frontier
  // ahead of the checkpoint that actually stores the content. Checkpoint-ahead
  // is the safe direction — the restore reads the checkpoint and the record
  // catches up on the next persist.
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
  const rebuiltEndVersion = encodeVersionVector(input.rebuiltDoc);
  await input.state.persistence.replaceHistoryCheckpoint?.(
    input.state.runtime.infra.execSql,
    {
      coveredTailIds: coveredHistoryTailIds(tailEntries, rebuiltEndVersion),
      endVersionVector: rebuiltEndVersion,
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
        // The checkpoint written above covers exactly this frontier.
        snapshotEndVersion: rebuiltEndVersion,
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
