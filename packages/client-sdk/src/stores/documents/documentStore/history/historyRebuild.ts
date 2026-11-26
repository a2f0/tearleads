import { bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import { readPullContinuation } from "../../../../data/documents/shared/sync/syncPagination";
import type {
  DocumentSyncPullContinuation,
  SyncRemoteDocumentResult,
} from "../../../../workflows/documents";
import { persistDocument } from "../persistence";
import type { DocumentState, DocumentStoreState } from "../state";
import { noteDocumentDownloadDrained } from "../sync/downloadCompletion";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "../sync/syncGeneration";
import { installDocumentWriterProjection } from "../writerProjectionGeneration";

/**
 * Installs a full-history document rebuilt from a verified raw remote pull.
 * The rotation preflight (rotation/index.ts) pulls the remote op log into a
 * fresh document, proves the live history against it, and installs it
 * here, preserving op identity end to end. Queued ordinary updates are
 * committed and pulled again before the install; they are never installed
 * from the queue.
 */

export async function installRebuiltDocument(input: {
  consumedPullContinuation: DocumentSyncPullContinuation | null;
  currentRecord: NonNullable<DocumentStoreState["record"]>;
  generation: DocumentStoreSyncGeneration;
  rebuiltDoc: DocumentState;
  /**
   * The rebuilt document's version when its raw pull completed, before any
   * other import: what the server served, recorded as committed.
   */
  servedVersion: string;
  state: DocumentStoreState;
  synced: SyncRemoteDocumentResult;
  /** `state.writerProjectionGeneration` when the recovery pull started. */
  writerProjectionGeneration: number;
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
      // What every page of the raw pull served, so the server holds all
      // of it. Never the rebuilt document's own version: an operation the
      // rebuild held beyond the pull would be counted committed unsent.
      committedVersions: [input.servedVersion],
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
    // The rebuild replays durable history only; live-only ops are gone.
    input.state.unsavedLocalEdits = false;
    // A recovery pull that drained a queued download finishes it.
    noteDocumentDownloadDrained({
      requestRecord: input.currentRecord,
      requestedPage: input.consumedPullContinuation !== null,
      state: input.state,
      storedRecord: persisted.record,
    });
  }
  if (persisted.pullContinuationSuperseded) input.state.writerProjection = null;
  else
    installDocumentWriterProjection(
      input.state,
      input.synced.writerProjection ?? input.state.writerProjection,
      input.writerProjectionGeneration,
    );
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
