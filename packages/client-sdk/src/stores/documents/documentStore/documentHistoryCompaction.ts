import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportFullHistorySnapshot,
  updateMatchesDocumentHistory,
} from "@tearleads/loro";
import {
  DOCUMENT_HISTORY_COMPACTION_MAX_BYTES,
  DOCUMENT_HISTORY_COMPACTION_MAX_ROWS,
} from "../../../workflows/documents";
import type { DocumentState, DocumentStoreState } from "./state";
import {
  captureDocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent as isSyncGenerationCurrent,
} from "./syncGeneration";

/**
 * Refresh the durable full-history checkpoint when the tail has grown past
 * the compaction thresholds, or seed the first checkpoint as soon as the
 * document can export full history (a freshly created or rebuilt document is
 * cheap to export; waiting for the threshold would leave restarts without
 * history until then). The snapshot comes from the LIVE document, which has
 * every tail update imported, so clearing the tail loses nothing.
 */
export async function maybeCompactDocumentHistory(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  stillCurrent?: (() => boolean) | undefined,
): Promise<void> {
  const { persistence } = state;
  // Bind this compaction to the store context it started under: a store
  // reset or runtime swap mid-compaction must not let the OLD document's
  // checkpoint overwrite the replacement generation's history (or land in a
  // newly selected database).
  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (!generation || stillCurrent?.() === false) {
    return;
  }
  const execSql = state.runtime.infra.execSql;
  const tail = await persistence.readHistoryTailSize(execSql, state.localId);
  if (
    tail.hasCheckpoint &&
    tail.rowCount < DOCUMENT_HISTORY_COMPACTION_MAX_ROWS &&
    tail.byteLength < DOCUMENT_HISTORY_COMPACTION_MAX_BYTES
  ) {
    return;
  }

  // Capture the tail BEFORE exporting, then prove coverage per row: another
  // pane can append ops this pane's document has not merged, so blanket
  // deletion would discard the only durable copy. Unproven rows survive for
  // a later compaction by whichever pane holds their ops.
  const tailEntries = await persistence.listHistoryTailEntries(
    execSql,
    state.localId,
  );
  const snapshot = exportFullHistorySnapshot(currentDoc);
  if (
    !isSyncGenerationCurrent(state, generation) ||
    stillCurrent?.() === false
  ) {
    return;
  }
  const endVersionVector = encodeVersionVector(currentDoc);
  await persistence.replaceHistoryCheckpoint(execSql, {
    coveredTailIds: coveredHistoryTailIds(tailEntries, currentDoc),
    endVersionVector,
    localId: state.localId,
    snapshot: bytesToBase64(snapshot),
    stillCurrent: () =>
      isSyncGenerationCurrent(state, generation) && stillCurrent?.() !== false,
  });
}

/**
 * Tail rows whose exact operations already belong to the checkpoint document.
 * Version-vector dominance is insufficient: a same-frontier fork has the same
 * declared range, and malformed rows must survive so recovery fails closed
 * instead of compaction deleting the evidence before provenance validation.
 */
function coveredHistoryTailIds(
  tailEntries: readonly { id: string; updateData: string }[],
  document: DocumentState,
): string[] {
  return tailEntries.flatMap((entry) => {
    try {
      return updateMatchesDocumentHistory(
        document,
        base64ToBytes(entry.updateData),
      )
        ? [entry.id]
        : [];
    } catch {
      return [];
    }
  });
}
