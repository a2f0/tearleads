import { bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import { readPullContinuation } from "../../../data/documents/shared/syncPagination";
import type {
  DocumentSyncPullContinuation,
  syncRemoteDocument,
} from "../../../workflows/documents";
import { persistDocument } from "./persistence";
import type { DocumentState, DocumentStoreState } from "./state";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";

/**
 * Machinery for reconstructing a full-history document from a verified remote
 * pull. Used by the rotation preflight (rotation.ts): it pulls the remote op
 * log, replays it into a fresh document alongside the durable local queue,
 * and installs the rebuilt document — preserving op identity end to end.
 */

export async function installRebuiltDocument(input: {
  consumedPullContinuation: DocumentSyncPullContinuation | null;
  currentRecord: NonNullable<DocumentStoreState["record"]>;
  generation: DocumentStoreSyncGeneration;
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
  const fullHistorySnapshot = exportFullHistorySnapshot(input.rebuiltDoc);
  const rebuiltEndVersion = encodeVersionVector(input.rebuiltDoc);
  const persisted = await persistDocument(
    input.state,
    input.rebuiltDoc,
    {
      ...input.synced.persistedState,
      lastCommitLsn:
        input.synced.response.commitLsn ??
        input.currentRecord.lastCommitLsn ??
        null,
      pullContinuation: readPullContinuation(input.synced.response),
      recoveryGeneration: (input.currentRecord.recoveryGeneration ?? 0) + 1,
      // The guarded checkpoint below covers exactly this frontier.
      snapshotEndVersion: rebuiltEndVersion,
    },
    {
      acceptedPendingUpdateIds: input.synced.settledPendingUpdateIds,
      expectedSyncState: {
        pullContinuation: input.consumedPullContinuation,
        record: input.currentRecord,
      },
      historyCheckpoint: {
        coveredTailIds: [],
        endVersionVector: rebuiltEndVersion,
        pruneCoveredLocalState: true,
        snapshot: bytesToBase64(fullHistorySnapshot),
      },
      pendingBaseVersionOverride: rebuiltEndVersion,
      preserveSnapshotStructuredFields: input.state.pendingLocalWrites > 0,
      preserveSnapshotText: input.state.pendingLocalWrites > 0,
    },
    input.generation,
  );
  if (!persisted) {
    if (!isDocumentStoreSyncGenerationCurrent(input.state, input.generation)) {
      throw new Error(
        "Document changed during rotation recovery; retry key rotation",
      );
    }
    // The resurrect guard refused: another subsystem deleted this document
    // while the rebuild was in flight, and saveDocumentRecord cleared the
    // zombie store — pendingBaseVersion included. Restoring the rebuilt doc,
    // projection, or the captured base version here would resurrect state
    // over that clearing.
    throw new Error(
      "Document was deleted while its history rebuild was in flight",
    );
  }
  if (
    !persisted.pullContinuationSuperseded &&
    !persisted.syncIdentitySuperseded
  ) {
    input.state.pendingBaseVersion = rebuiltEndVersion;
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
