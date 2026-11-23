import type { createDocument } from "@tearleads/loro";
import {
  importSnapshot,
  importUpdates,
  isLoroRuntimeFailure,
} from "@tearleads/loro";
import type { DecryptedDocumentSyncUpdate } from "./documentSyncTypes";
import {
  type LoroRuntimeAttempts,
  processLoroRuntimeFailures,
} from "./loroRuntimeFailureLedger";

type SyncDocument = Awaited<ReturnType<typeof createDocument>>;

function splitDocumentSyncUpdates(
  updates: readonly DecryptedDocumentSyncUpdate[],
): {
  checkpoints: DecryptedDocumentSyncUpdate[];
  ordinaryUpdates: DecryptedDocumentSyncUpdate[];
} {
  const checkpoints: DecryptedDocumentSyncUpdate[] = [];
  const ordinaryUpdates: DecryptedDocumentSyncUpdate[] = [];
  for (const update of updates) {
    if (
      update.checkpointKind === "rotate_baseline" &&
      update.checkpointPayloadKind === "full_history_snapshot"
    ) {
      checkpoints.push(update);
    } else {
      ordinaryUpdates.push(update);
    }
  }
  return { checkpoints, ordinaryUpdates };
}

/** Applies checkpoints with the snapshot API before batching ordinary deltas. */
export function importDecryptedDocumentSyncUpdates(
  document: SyncDocument,
  updates: readonly DecryptedDocumentSyncUpdate[],
): void {
  const { checkpoints, ordinaryUpdates } = splitDocumentSyncUpdates(updates);
  for (const checkpoint of checkpoints) {
    importSnapshot(document, checkpoint.updateData);
  }
  if (ordinaryUpdates.length > 0) {
    importUpdates(
      document,
      ordinaryUpdates.map((update) => update.updateData),
    );
  }
}

/**
 * Applies a judged page's updates to a live document. A Loro runtime failure
 * here may leave the module unusable, so it marks this process as failed
 * before it propagates, and a failure the sync judge meets later in this
 * process counts toward no update.
 */
export function importLiveDocumentSyncUpdates(
  document: SyncDocument,
  updates: readonly DecryptedDocumentSyncUpdate[],
  ledger: LoroRuntimeAttempts = processLoroRuntimeFailures,
): void {
  try {
    importDecryptedDocumentSyncUpdates(document, updates);
  } catch (error) {
    if (isLoroRuntimeFailure(error)) ledger.noteUnattributedFailure();
    throw error;
  }
}
