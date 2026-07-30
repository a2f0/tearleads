import {
  defaultDocumentsPersistence,
  reclaimDocumentOrphanBlobs,
} from "../../../workflows/documents";
import type { DocumentStoreState } from "./state";

/** Run SQL-only maintenance without making document initialization wait for it. */
export async function runDocumentOrphanMaintenance(
  state: DocumentStoreState,
): Promise<void> {
  if (state.persistence === defaultDocumentsPersistence) {
    await reclaimDocumentOrphanBlobs(state.runtime);
  }
}
