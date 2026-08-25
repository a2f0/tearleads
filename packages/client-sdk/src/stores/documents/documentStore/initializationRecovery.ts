import { encodeVersionVector } from "@symcrypt/loro";
import {
  addDocumentAttachments,
  type DocumentAttachment,
  getDocumentAttachments,
} from "../../../data/documents/documentContent";
import type { LocalAttachmentRecord } from "../../../workflows/documents";
import { reconcileLocalAttachmentDetachState } from "./attachmentDetachState";
import { saveLocalAttachmentRecord } from "./attachmentPersistence";
import { rebaseDocumentAfterPendingUpdateRefusal } from "./pendingUpdateRefusal";
import {
  advancePendingBaseVersion,
  enqueuePendingUpdate,
  pendingDeltaSinceBase,
  persistDocument,
} from "./persistence";
import type { DocumentState, DocumentStoreState } from "./state";
import type { DocumentStoreSyncGeneration } from "./syncGeneration";

// Re-derive any attachment slot that lives in a durable pending-upload row but
// is missing (or stale) in the loaded snapshot. The attach write path persists
// the blob bytes + pending-attachment row BEFORE it enqueues the slot's CRDT op
// and persists the snapshot, so a crash in that window leaves bytes+row durable
// but the slot gone from the document — the attachment would otherwise silently
// disappear on restart while its bytes upload to a binding nothing references
// (and a slot replace would keep stale metadata). Because the pending row still
// carries the slot's name/byteLength/mimeType and the bytes are on disk, we can
// rebuild the slot exactly and let the normal sync upload it. Runs on init only;
// a no-op when every pending attachment already matches a slot.
export async function recoverDroppedAttachmentSlots(
  state: DocumentStoreState,
  doc: DocumentStoreState["doc"],
  writeGeneration: DocumentStoreSyncGeneration,
): Promise<void> {
  if (!doc || state.pendingAttachments.length === 0) {
    return;
  }

  const existingBySlotId = new Map(
    getDocumentAttachments(doc).map((attachment) => [
      attachment.slotId,
      attachment,
    ]),
  );
  const recovered: DocumentAttachment[] = [];
  for (const pending of state.pendingAttachments) {
    const mimeType = pending.mimeType ?? null;
    const existing = existingBySlotId.get(pending.slotId);
    if (
      existing &&
      existing.name === pending.name &&
      existing.byteLength === pending.byteLength &&
      existing.mimeType === mimeType
    ) {
      continue;
    }
    recovered.push({
      byteLength: pending.byteLength,
      mimeType,
      name: pending.name,
      slotId: pending.slotId,
    });
  }
  if (recovered.length === 0) {
    return;
  }

  addDocumentAttachments(doc, recovered);
  const update = pendingDeltaSinceBase(state, doc);
  // Every durable write is gated on the captured generation — the enqueue
  // validates it INSIDE its serialized mutation, and the persist re-checks
  // via its expectedGeneration overload — so a store reset (e.g. a
  // local-edits discard) racing this recovery cannot see it re-enqueue or
  // re-persist the state the teardown just removed.
  if (update.byteLength > 0) {
    const enqueued = await enqueuePendingUpdate(
      state,
      update,
      undefined,
      writeGeneration,
    );
    if (!enqueued) {
      const rebased = await rebaseDocumentAfterPendingUpdateRefusal(
        state,
        writeGeneration,
      );
      if (rebased) {
        // Initialization captured the losing identity and must restart from
        // the winner, including its attachment rows and detach markers.
        throw new Error(
          "Document identity changed during attachment recovery; retry initialization",
        );
      }
      return;
    }
  }
  // Derive the snapshot from the loaded doc (do NOT preserve the snapshot). This
  // runs during init, before the store is ready, so state.snapshot is still the
  // empty initial snapshot — preserving it would publish a ready snapshot with
  // empty text/structured fields (a flash of empty content) over the real loaded
  // content. There is no in-flight user edit to protect here. The doc is
  // private to initialization and the enqueue above dual-wrote its delta, so
  // its version is a durably covered frontier.
  const persisted = await persistDocument(
    state,
    doc,
    { snapshotEndVersion: encodeVersionVector(doc) },
    {},
    writeGeneration,
  );
  if (
    !persisted ||
    persisted.pullContinuationSuperseded ||
    persisted.syncIdentitySuperseded
  ) {
    return;
  }
  advancePendingBaseVersion(state, doc);
  state.runtime.util.log(
    `Documents: recovered ${recovered.length} attachment slot(s) from pending uploads after an interrupted write.`,
  );
}

/**
 * Realign detach markers with the loaded document.
 *
 * Removing an attachment marks its row detached and then persists the document;
 * a stop between those two writes leaves the halves disagreeing, and neither
 * the sync detach pass (which reads the document) nor the read models (which
 * read the marker) can resolve that on their own. The loaded document is the
 * durable truth, so the marker follows it.
 */
export async function healLocalAttachmentDetachState(
  state: DocumentStoreState,
  doc: DocumentState,
  persistedState: { localAttachments: ReadonlyArray<LocalAttachmentRecord> },
  writeGeneration: DocumentStoreSyncGeneration,
): Promise<void> {
  const healed = reconcileLocalAttachmentDetachState(
    persistedState.localAttachments,
    doc,
  );
  for (const attachment of healed) {
    // The save validates the generation inside its serialized mutation, so a
    // concurrent store reset can never see this heal rewrite rows the
    // teardown just removed.
    await saveLocalAttachmentRecord(state, attachment, doc, writeGeneration);
  }
  if (healed.length > 0) {
    state.runtime.util.log(
      `Documents: realigned ${healed.length} attachment detach marker(s) with the loaded document.`,
    );
  }
}
