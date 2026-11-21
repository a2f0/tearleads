import type {
  AttachmentRemovalMarker,
  OpenAttachmentRemovalMarker,
} from "../../../../data/documents/attachmentRemovalMarkerMachine";
import { getDocumentAttachments } from "../../../../data/documents/documentContent";
import {
  type AttachmentRemovalMarkerSettlement,
  settleDocumentAttachmentRemovalMarker,
} from "../../../../workflows/documents";
import { runDocumentOrphanMaintenance } from "../orphanMaintenance";
import {
  type DocumentState,
  type DocumentStoreState,
  setReadySnapshot,
} from "../state";
import {
  assignLocalAttachmentSlots,
  removeLocalAttachmentSlot,
  upsertPendingAttachments,
} from "./attachmentPersistence";

/** A copy this store removed and still maps until its marker settles. */
export interface AttachmentRemovalMarkerSlot {
  slotId: string;
  storageKey: string;
}

/**
 * The slots this store maps to a held copy that `doc` no longer has. Each is
 * a removal marker unless committed history has the slot again, which only
 * the durable settle can tell.
 */
export function listAttachmentRemovalMarkers(
  state: DocumentStoreState,
  doc: DocumentState,
): AttachmentRemovalMarkerSlot[] {
  const liveSlotIds = new Set(
    getDocumentAttachments(doc).map((attachment) => attachment.slotId),
  );
  return Object.entries(state.attachmentStorageKeyBySlotId).flatMap(
    ([slotId, storageKey]) =>
      liveSlotIds.has(slotId) ? [] : [{ slotId, storageKey }],
  );
}

function installSettledMarker(
  state: DocumentStoreState,
  marker: AttachmentRemovalMarkerSlot,
  settled: AttachmentRemovalMarkerSettlement,
  doc: DocumentState | null,
): void {
  // Another write in this store already refilled the slot; it owns the maps.
  if (state.attachmentStorageKeyBySlotId[marker.slotId] !== marker.storageKey)
    return;
  removeLocalAttachmentSlot(state, marker.slotId);
  if (settled.row) assignLocalAttachmentSlots(state, [settled.row]);
  if (settled.pending) upsertPendingAttachments(state, [settled.pending]);
  if (doc && doc === state.doc) {
    setReadySnapshot(
      state,
      doc,
      state.snapshot.syncing,
      state.snapshot.text,
      state.snapshot.structuredFields,
    );
  }
}

/**
 * Settle one removal marker against committed document history and mirror
 * the durable outcome into this store. Null when `stillCurrent` turned false;
 * nothing was written or installed then.
 */
export async function settleAttachmentRemovalMarker(input: {
  doc: DocumentState | null;
  from: OpenAttachmentRemovalMarker;
  marker: AttachmentRemovalMarkerSlot;
  state: DocumentStoreState;
  stillCurrent: () => boolean;
}): Promise<AttachmentRemovalMarker | null> {
  const { marker, state, stillCurrent } = input;
  const settled = await settleDocumentAttachmentRemovalMarker({
    execSql: state.runtime.infra.execSql,
    from: input.from,
    localId: state.localId,
    persistence: state.persistence,
    slotId: marker.slotId,
    stillCurrent,
    storageKey: marker.storageKey,
  });
  if (!settled || !stillCurrent()) return null;
  const { status } = settled.marker;
  if (status === "awaitingDetach" || status === "remoteDetached") {
    return settled.marker;
  }
  installSettledMarker(state, marker, settled, input.doc);
  // Dropping the row queued its bytes for the reference-checked reclaim.
  if (status === "dropped") void runDocumentOrphanMaintenance(state);
  return settled.marker;
}
