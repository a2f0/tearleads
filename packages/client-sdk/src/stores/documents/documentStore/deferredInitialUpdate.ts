import { encodeVersionVector, satisfiesVersionVector } from "@tearleads/loro";
import { createPendingUpdateFields } from "../../../data/documents/documentSync";
import { requestDocumentStoreSync } from "../registry";
import {
  type AttachmentWriteGeneration,
  isAttachmentWriteGenerationCurrent,
} from "./attachmentWriteGeneration";
import {
  advancePendingBaseVersion,
  pendingDeltaSinceBase,
  persistDocument,
} from "./persistence";
import type { DocumentStoreState } from "./state";
import {
  captureDocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";

/**
 * Runs after the first attach on a store opened with `deferInitialUpdate`.
 * Creation committed the birth without a pending update, leaving the marker at
 * the empty version so that attach's delta would carry it, and scheduled sync
 * passes wait meanwhile (see `canRunScheduledSync`) so none ships the birth on
 * its own. When the attach did not land (staging failed or returned null, its
 * persist was refused, or the store could not attach), enqueue the deferred
 * tail now so the document still syncs, without its attachment. Either way,
 * lift the hold and request the pass it skipped.
 */
export async function settleDeferredInitialUpdate(
  state: DocumentStoreState,
  writeGeneration: AttachmentWriteGeneration,
): Promise<void> {
  if (!state.deferInitialUpdate) return;
  state.deferInitialUpdate = false;
  try {
    await enqueueDeferredTail(state, writeGeneration);
  } finally {
    requestDocumentStoreSync(state);
  }
}

async function enqueueDeferredTail(
  state: DocumentStoreState,
  writeGeneration: AttachmentWriteGeneration,
): Promise<void> {
  // A reset or relink owns the replacement store; its deferred tail stays
  // durable and the next write or sync pass materializes it.
  if (!isAttachmentWriteGenerationCurrent(state, writeGeneration)) return;
  const currentDoc = state.doc;
  const record = state.record;
  const baseVersion = state.pendingBaseVersion;
  if (!currentDoc || !record || baseVersion === null) return;
  const documentVersion = encodeVersionVector(currentDoc);
  // Settled: the attach (or an earlier write) already enqueued the birth.
  if (satisfiesVersionVector(baseVersion, documentVersion)) return;
  // Only enqueue content the record proves durable. A failed attach whose
  // rollback could not run leaves its uncommitted slot in the live doc, and
  // that slot must never sync without its staged bytes.
  if (!satisfiesVersionVector(record.snapshotEndVersion, documentVersion)) {
    return;
  }
  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (!generation) return;
  const pendingUpdate = createPendingUpdateFields(
    pendingDeltaSinceBase(state, currentDoc),
  );
  if (!pendingUpdate) return;
  const persisted = await persistDocument(
    state,
    currentDoc,
    { snapshotEndVersion: documentVersion },
    {
      pendingUpdate,
      preserveSnapshotStructuredFields: true,
      preserveSnapshotText: true,
    },
    generation,
  );
  if (!persisted || !isDocumentStoreSyncGenerationCurrent(state, generation)) {
    return;
  }
  advancePendingBaseVersion(state, currentDoc);
}
