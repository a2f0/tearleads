import { bytesToBase64 } from "@symcrypt/encoding";
import {
  encodeVersionVector,
  exportFullHistorySnapshot,
  satisfiesVersionVector,
} from "@symcrypt/loro";
import { readPullContinuation } from "../../../data/documents/shared/syncPagination";
import type {
  DocumentSyncPullContinuation,
  syncRemoteDocument,
} from "../../../workflows/documents";
import {
  advancePendingBaseVersion,
  coveredHistoryTailIds,
  listPendingUpdates,
  persistDocument,
} from "./persistence";
import type { DocumentState, DocumentStoreState } from "./state";

/**
 * Machinery for reconstructing a full-history document from a verified remote
 * pull. Used by the rotation preflight (rotation.ts): it pulls the remote op
 * log, replays it into a fresh document alongside the durable local queue,
 * and installs the rebuilt document — preserving op identity end to end.
 */

export async function installRebuiltDocument(input: {
  consumedPullContinuation: DocumentSyncPullContinuation | null;
  currentRecord: NonNullable<DocumentStoreState["record"]>;
  rebuiltDoc: DocumentState;
  state: DocumentStoreState;
  synced: NonNullable<Awaited<ReturnType<typeof syncRemoteDocument>>>;
}): Promise<{
  fullHistorySnapshot: Uint8Array;
  settlementRequiresRetry: boolean;
}> {
  // The guarded persist makes the recovered history durable BEFORE publishing
  // the newer record. Checkpoint-ahead is the safe crash direction: restore
  // reads the checkpoint and the record catches up on the next persist.
  // The tail is captured BEFORE the export and each row's coverage is
  // proven against the rebuilt document, so an update appended concurrently
  // (or by another pane) that this rebuild does not contain survives for a
  // later compaction.
  const tailEntries = await input.state.persistence.listHistoryTailEntries(
    input.state.runtime.infra.execSql,
    input.state.localId,
  );
  const fullHistorySnapshot = exportFullHistorySnapshot(input.rebuiltDoc);
  const rebuiltEndVersion = encodeVersionVector(input.rebuiltDoc);
  const coveredCheckpointIds = (await listPendingUpdates(input.state)).flatMap(
    (update) =>
      update.sourceVersionVector != null &&
      satisfiesVersionVector(rebuiltEndVersion, update.sourceVersionVector)
        ? [update.id]
        : [],
  );
  const previousPendingBaseVersion = input.state.pendingBaseVersion;
  advancePendingBaseVersion(input.state, input.rebuiltDoc);
  let persisted: Awaited<ReturnType<typeof persistDocument>>;
  try {
    persisted = await persistDocument(
      input.state,
      input.rebuiltDoc,
      {
        ...input.synced.persistedState,
        lastCommitLsn:
          input.synced.response.commitLsn ??
          input.currentRecord.lastCommitLsn ??
          null,
        pullContinuation: readPullContinuation(input.synced.response),
        // The guarded checkpoint below covers exactly this frontier.
        snapshotEndVersion: rebuiltEndVersion,
      },
      {
        // Retire locally queued checkpoints only when the verified rebuild
        // proves it covers their declared frontier. Keeping one would let a
        // later ordinary sync republish an untrusted redirect after recovery.
        // The specific row deletions share the guarded install transaction.
        acceptedPendingUpdateIds: input.synced.settledPendingUpdateIds,
        commitOnlyPendingUpdateIds: coveredCheckpointIds,
        expectedSyncState: {
          pullContinuation: input.consumedPullContinuation,
          record: input.currentRecord,
        },
        historyCheckpoint: {
          coveredTailIds: coveredHistoryTailIds(tailEntries, rebuiltEndVersion),
          endVersionVector: rebuiltEndVersion,
          snapshot: bytesToBase64(fullHistorySnapshot),
        },
        preserveSnapshotStructuredFields: input.state.pendingLocalWrites > 0,
        preserveSnapshotText: input.state.pendingLocalWrites > 0,
      },
    );
  } catch (error) {
    input.state.pendingBaseVersion = previousPendingBaseVersion;
    throw error;
  }
  if (!persisted) {
    // The resurrect guard refused: another subsystem deleted this document
    // while the rebuild was in flight, and saveDocumentRecord cleared the
    // zombie store — pendingBaseVersion included. Restoring the rebuilt doc,
    // projection, or the captured base version here would resurrect state
    // over that clearing.
    throw new Error(
      "Document was deleted while its history rebuild was in flight",
    );
  }
  if (!persisted.syncIdentitySuperseded) {
    input.state.doc = input.rebuiltDoc;
  }
  input.state.writerProjection = persisted.pullContinuationSuperseded
    ? null
    : (input.synced.writerProjection ?? input.state.writerProjection);
  const installedDoc = input.state.doc ?? input.rebuiltDoc;
  return {
    fullHistorySnapshot: persisted.pullContinuationSuperseded
      ? exportFullHistorySnapshot(installedDoc)
      : fullHistorySnapshot,
    settlementRequiresRetry:
      persisted.pullContinuationSuperseded === true ||
      persisted.syncIdentitySuperseded === true ||
      persisted.record.pullContinuation != null ||
      persisted.record.pullContinuationRecoveryRequired === true,
  };
}
