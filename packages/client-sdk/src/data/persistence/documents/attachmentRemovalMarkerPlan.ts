import {
  attachmentMarkerRowEffect,
  type OpenAttachmentRemovalMarker,
  observeAttachmentMarkerRow,
  observeCommittedAttachmentSlot,
  transitionAttachmentRemovalMarker,
} from "../../documents/attachmentRemovalMarkerMachine";
import type {
  AttachmentRemovalMarkerObservation,
  AttachmentRemovalMarkerSettlement,
  LocalAttachmentRecord,
} from "./attachmentRecords";

/**
 * Settle a removal marker for the copy at `storageKey` against what one
 * transaction read, and give the slot's rows after it. Pure: every persistence
 * adapter applies the same outcome.
 */
export function planAttachmentRemovalMarkerSettlement(input: {
  from: OpenAttachmentRemovalMarker;
  now: string;
  observed: AttachmentRemovalMarkerObservation;
  storageKey: string;
}): AttachmentRemovalMarkerSettlement {
  const { committed, row } = input.observed;
  const observedRow = observeAttachmentMarkerRow(row, input.storageKey);
  const marker = transitionAttachmentRemovalMarker(input.from, {
    row: observedRow,
    slot: observeCommittedAttachmentSlot(committed),
    type: "committedChecked",
  });
  const unchanged: AttachmentRemovalMarkerSettlement = {
    marker,
    pending: null,
    row,
    write: "none",
  };
  if (!row) return unchanged;
  const upsert = (
    next: LocalAttachmentRecord,
  ): AttachmentRemovalMarkerSettlement => ({
    marker,
    pending: null,
    row: next,
    write: "upsert",
  });
  switch (attachmentMarkerRowEffect(marker, observedRow)) {
    case "none":
      return unchanged;
    case "markDetached":
      return upsert({ ...row, detachedAt: input.now });
    case "revive":
      return upsert({ ...row, detachedAt: null });
    case "delete":
      return { marker, pending: null, row: null, write: "delete" };
    case "requeueUpload": {
      // Stage the held bytes again, as a fresh attach would, to bind anew.
      if (!committed) throw new Error("A rebound slot must be committed");
      return {
        marker,
        pending: {
          byteLength: row.byteLength,
          contentSha256: row.contentSha256,
          localId: row.localId,
          mimeType: committed.mimeType,
          name: committed.name,
          slotId: row.slotId,
          storageKey: row.storageKey,
        },
        row: { ...row, blobId: null, detachedAt: null },
        write: "upsert",
      };
    }
  }
}
