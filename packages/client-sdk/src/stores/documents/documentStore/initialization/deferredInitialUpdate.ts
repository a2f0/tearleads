import { encodeVersionVector, satisfiesVersionVector } from "@tearleads/loro";
import { createPendingUpdateFields } from "../../../../data/documents/documentSync";
import { requestDocumentStoreSync } from "../../registry";
import {
  type AttachmentWriteGeneration,
  captureAttachmentWriteGeneration,
  isAttachmentWriteGenerationCurrent,
} from "../attachments/attachmentWriteGeneration";
import { reloadDocumentFromDurableHistory } from "../history/durableDocumentReload";
import {
  advancePendingBaseVersion,
  pendingDeltaSinceBase,
  persistDocument,
} from "../persistence";
import { type DocumentStoreState, resetDocumentStore } from "../state";
import {
  captureDocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "../sync/syncGeneration";
import { ensureDocumentStoreInitialized } from "./index";

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
  writeGeneration: AttachmentWriteGeneration | null,
): Promise<void> {
  if (!state.deferInitialUpdate) return;
  // Before initialization finishes no attach has touched a live doc, and a
  // reload here would install one behind initialization's back (or mark a
  // not-yet-created document removed). Lift the hold; initialization then
  // restores the empty marker and schedules the pass that ships the birth.
  if (!state.initialized) {
    state.deferInitialUpdate = false;
    return;
  }
  // A pass exports the live doc, so it must hold only durable content (see
  // restoreDurableLiveDocument) before the hold lifts. When that cannot be
  // shown, even after a transient failure, reinitialize from durable history
  // rather than latch the hold: the reset lifts it and drops the live doc.
  let durable = false;
  try {
    durable = await restoreDurableLiveDocument(state);
  } finally {
    if (!durable && state.deferInitialUpdate && state.doc) {
      resetDocumentStore(state);
      ensureDocumentStoreInitialized(state, () =>
        requestDocumentStoreSync(state),
      );
    } else if (!durable) {
      // No live doc remains to leak (a concurrent removal): just lift it.
      state.deferInitialUpdate = false;
    }
  }
  if (!durable) return;
  state.deferInitialUpdate = false;
  try {
    await enqueueDeferredTail(state, writeGeneration);
  } finally {
    requestDocumentStoreSync(state);
  }
}

function isLiveDocumentDurable(state: DocumentStoreState): boolean {
  return (
    state.doc !== null &&
    state.record !== null &&
    satisfiesVersionVector(
      state.record.snapshotEndVersion,
      encodeVersionVector(state.doc),
    )
  );
}

/**
 * A failed attach whose rollback reload could not run (its generation went
 * stale mid-stage) leaves the uncommitted slot in the live doc, and that slot
 * must never sync without its staged bytes. Reload durable history under a
 * fresh generation before trusting the live doc.
 */
async function restoreDurableLiveDocument(
  state: DocumentStoreState,
): Promise<boolean> {
  if (isLiveDocumentDurable(state)) return true;
  const generation = captureDocumentStoreSyncGeneration(state, state.doc);
  if (generation) {
    await reloadDocumentFromDurableHistory({
      expectedGeneration: generation,
      preserveQueuedWritesWhenIdentityMatches: true,
      state,
    });
  }
  return isLiveDocumentDurable(state);
}

async function enqueueDeferredTail(
  state: DocumentStoreState,
  writeGeneration: AttachmentWriteGeneration | null,
): Promise<void> {
  // A reset or relink owns the replacement store; its deferred tail stays
  // durable and the next write or sync pass materializes it. With no attach
  // (nothing to attach, or the store was not writable) the live store owns it.
  const generation = writeGeneration ?? captureAttachmentWriteGeneration(state);
  if (!generation || !isAttachmentWriteGenerationCurrent(state, generation)) {
    return;
  }
  const currentDoc = state.doc;
  const baseVersion = state.pendingBaseVersion;
  if (!currentDoc || baseVersion === null) return;
  const documentVersion = encodeVersionVector(currentDoc);
  // Settled: the attach (or an earlier write) already enqueued the birth.
  if (satisfiesVersionVector(baseVersion, documentVersion)) return;
  const syncGeneration = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (!syncGeneration) return;
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
    syncGeneration,
  );
  if (
    !persisted ||
    !isDocumentStoreSyncGenerationCurrent(state, syncGeneration)
  ) {
    return;
  }
  advancePendingBaseVersion(state, currentDoc);
}
