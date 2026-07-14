import { importSnapshot, importUpdates } from "@tearleads/loro";
import type { DecryptedDocumentSyncUpdate } from "../../../data/documents/shared/types";
import type { DocumentState } from "./state";

export function importSyncedDocumentUpdates(
  currentDoc: DocumentState,
  updates: readonly DecryptedDocumentSyncUpdate[],
): DocumentState {
  const checkpoints = updates.filter(
    (update) =>
      update.checkpointKind === "rotate_baseline" &&
      update.checkpointPayloadKind === "full_history_snapshot",
  );
  // Import checkpoints individually before the ordinary batch because
  // importBatch can silently ignore snapshot blobs.
  for (const checkpoint of checkpoints) {
    importSnapshot(currentDoc, checkpoint.updateData);
  }
  const ordinaryUpdates = updates
    .filter(
      (update) =>
        update.checkpointKind !== "rotate_baseline" ||
        update.checkpointPayloadKind !== "full_history_snapshot",
    )
    .map((update) => update.updateData);
  if (ordinaryUpdates.length > 0) {
    importUpdates(currentDoc, ordinaryUpdates);
  }
  return currentDoc;
}
