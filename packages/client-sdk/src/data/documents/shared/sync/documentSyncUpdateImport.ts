import type { createDocument } from "@tearleads/loro";
import { importSnapshot, importUpdates } from "@tearleads/loro";
import type { DecryptedDocumentSyncUpdate } from "./documentSyncTypes";

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
