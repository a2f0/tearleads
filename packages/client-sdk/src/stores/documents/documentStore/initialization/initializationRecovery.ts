import { encodeVersionVector } from "@tearleads/loro";
import {
  addDocumentAttachments,
  type DocumentAttachment,
  getDocumentAttachments,
} from "../../../../data/documents/documentContent";
import type { LocalAttachmentRecord } from "../../../../workflows/documents";
import { listUnsettledAttachmentMarkers } from "../attachments/attachmentDetachState";
import { settleAttachmentRemovalMarker } from "../attachments/attachmentRemovalMarkers";
import { rebaseDocumentAfterPendingUpdateRefusal } from "../pendingUpdateRefusal";
import {
  advancePendingBaseVersion,
  enqueuePendingUpdate,
  pendingDeltaSinceBase,
  persistDocument,
} from "../persistence";
import type { DocumentState, DocumentStoreState } from "../state";
import type { DocumentStoreSyncGeneration } from "../sync/syncGeneration";
import { isDocumentStoreSyncGenerationCurrent } from "../sync/syncGeneration";

/**
 * The pending attachments whose slot is missing or stale in `doc`, or null
 * when the write generation moved on while comparing them.
 */
function droppedAttachmentSlots(
  state: DocumentStoreState,
  doc: NonNullable<DocumentStoreState["doc"]>,
  writeGeneration: DocumentStoreSyncGeneration,
): DocumentAttachment[] | null {
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
    const contentSha256 = pending.contentSha256;
    if (!isDocumentStoreSyncGenerationCurrent(state, writeGeneration)) {
      return null;
    }
    if (
      existing &&
      existing.name === pending.name &&
      existing.byteLength === pending.byteLength &&
      existing.mimeType === mimeType &&
      existing.contentSha256 === contentSha256
    ) {
      continue;
    }
    recovered.push({
      contentSha256,
      byteLength: pending.byteLength,
      mimeType,
      name: pending.name,
      slotId: pending.slotId,
    });
  }
  return recovered;
}

function persistedCurrent(
  persisted: Awaited<ReturnType<typeof persistDocument>>,
): boolean {
  return Boolean(
    persisted &&
      !persisted.pullContinuationSuperseded &&
      !persisted.syncIdentitySuperseded,
  );
}

// Re-derive any attachment slot that lives in a durable pending-upload row but
// is missing (or stale) in the loaded snapshot. The attach write path persists
// the blob bytes + pending-attachment row BEFORE it enqueues the slot's CRDT op
// and persists the snapshot, so a crash in that window leaves bytes+row durable
// but the slot gone from the document — the attachment would otherwise silently
// disappear on restart while its bytes upload to a binding nothing references
// (and a slot replace would keep stale metadata). Because the pending row still
// carries the slot's metadata and staging digest, we can rebuild the slot without
// opening bytes; normal upload reports missing sources. Runs on init only; a
// no-op when every pending attachment already matches a slot.
export async function recoverDroppedAttachmentSlots(
  state: DocumentStoreState,
  doc: DocumentStoreState["doc"],
  writeGeneration: DocumentStoreSyncGeneration,
): Promise<void> {
  if (!doc || state.pendingAttachments.length === 0) {
    return;
  }

  const recovered = droppedAttachmentSlots(state, doc, writeGeneration);
  if (!recovered || recovered.length === 0) {
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
  if (!persistedCurrent(persisted)) {
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
 * A live row can outlive its slot, and a slot this device removed can come
 * back from another pane or a pull before its detach was sent. Each row that
 * disagrees with the loaded document is settled against committed history
 * by the same transition the sync detach pass uses: a removed slot keeps (or
 * regains) its marker, a slot re-added with the same bytes revives the held
 * copy, and one re-added with other bytes drops the earlier copy so the new
 * one downloads like any first download.
 */
export async function healLocalAttachmentDetachState(
  state: DocumentStoreState,
  doc: DocumentState,
  persistedState: { localAttachments: ReadonlyArray<LocalAttachmentRecord> },
  writeGeneration: DocumentStoreSyncGeneration,
): Promise<void> {
  const unsettled = listUnsettledAttachmentMarkers(
    persistedState.localAttachments,
    doc,
  );
  // The settle commits only while this generation is current, so a
  // concurrent store reset never sees it rewrite rows the teardown removed.
  const stillCurrent = () =>
    isDocumentStoreSyncGenerationCurrent(state, writeGeneration);
  for (const { slotId, storageKey } of unsettled) {
    const settled = await settleAttachmentRemovalMarker({
      doc,
      from: { status: "awaitingDetach" },
      marker: { slotId, storageKey },
      state,
      stillCurrent,
    });
    if (!settled) return;
  }
  if (unsettled.length > 0) {
    state.runtime.util.log(
      `Documents: realigned ${unsettled.length} attachment detach marker(s) with the loaded document.`,
    );
  }
}
