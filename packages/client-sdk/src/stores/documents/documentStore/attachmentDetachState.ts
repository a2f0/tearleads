/**
 * Keeps a local attachment row's detach marker consistent with the document.
 *
 * The invariant is one line: a local blob row is marked detached exactly when
 * its slot is no longer in the document. The read models trust that marker to
 * decide whether a blob is still referenced, so anything that writes these rows
 * has to preserve it rather than restate what it believed the slots were.
 *
 * Two writers can otherwise clear a marker they never meant to touch: an upload
 * that settles after the user removed its slot, and a hydration that captured
 * the attachment list before an unlink and writes it back after. Both read the
 * slot list, await, then save — so the slot they save may already be gone.
 */
import { getDocumentAttachments } from "../../../data/documents/documentContent";
import type { LocalAttachmentRecord } from "../../../workflows/documents";
import type { DocumentState } from "./state";

function getLiveSlotIds(doc: DocumentState): ReadonlySet<string> {
  return new Set(
    getDocumentAttachments(doc).map((attachment) => attachment.slotId),
  );
}

/**
 * Stamp records being written for slots the document no longer has as detached.
 *
 * The document is read here, at write time, rather than trusted from the
 * caller's earlier snapshot — the Loro document is mutated in place, so this
 * sees any unlink that landed while the caller was awaiting.
 */
export function withLocalAttachmentDetachState(
  attachments: ReadonlyArray<LocalAttachmentRecord>,
  doc: DocumentState | null,
): LocalAttachmentRecord[] {
  if (!doc) {
    return [...attachments];
  }

  const detachedAt = new Date().toISOString();
  const liveSlotIds = getLiveSlotIds(doc);
  return attachments.map((attachment) =>
    attachment.detachedAt === null && !liveSlotIds.has(attachment.slotId)
      ? { ...attachment, detachedAt }
      : attachment,
  );
}

/**
 * Report the loaded rows whose marker disagrees with the loaded document.
 *
 * A write can only be interrupted between marking the row and persisting the
 * document, so a restart can find either half applied. Reconciling against the
 * durable document at load makes the marker mean what it claims again: a slot
 * the document still has is live, and a slot it dropped is detached.
 */
export function reconcileLocalAttachmentDetachState(
  attachments: ReadonlyArray<LocalAttachmentRecord>,
  doc: DocumentState,
): LocalAttachmentRecord[] {
  const detachedAt = new Date().toISOString();
  const liveSlotIds = getLiveSlotIds(doc);
  return attachments.flatMap((attachment) => {
    const slotIsLive = liveSlotIds.has(attachment.slotId);
    if (slotIsLive === (attachment.detachedAt === null)) {
      return [];
    }

    return [{ ...attachment, detachedAt: slotIsLive ? null : detachedAt }];
  });
}
