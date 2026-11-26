import type { createDocument } from "@tearleads/loro";
import { importUpdates, isLoroRuntimeFailure } from "@tearleads/loro";
import type { DecryptedDocumentSyncUpdate } from "./documentSyncTypes";
import {
  type LoroRuntimeAttempts,
  processLoroRuntimeFailures,
} from "./loroRuntimeFailureLedger";

type SyncDocument = Awaited<ReturnType<typeof createDocument>>;

/**
 * Applies updates in one import. A rotation baseline's segments are updates
 * like any other, and Loro pays for each import against the state it already
 * holds, so a page's updates go in together: the 13 segments of a 51 MiB
 * history took 7.7 s imported one at a time and about 0.5 s in one call.
 */
export function importDecryptedDocumentSyncUpdates(
  document: SyncDocument,
  updates: readonly DecryptedDocumentSyncUpdate[],
): void {
  if (updates.length === 0) return;
  importUpdates(
    document,
    updates.map((update) => update.updateData),
  );
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
