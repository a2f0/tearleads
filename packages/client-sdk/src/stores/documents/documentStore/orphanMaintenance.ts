import { reclaimDocumentOrphanBlobs } from "../../../workflows/documents";
import type { DocumentStoreState } from "./state";

/** Reclaim through the adapter that owns the attachment references. */
export async function runDocumentOrphanMaintenance(
  state: DocumentStoreState,
): Promise<void> {
  await reclaimDocumentOrphanBlobs(state.runtime, state.persistence);
}
