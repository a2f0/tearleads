/**
 * Attachment-slot persistence for stored documents.
 *
 * These are the workflow-level seams the document store writes attachment rows
 * through: the pending-upload queue, the local blob projection, and the detach
 * marker that keeps an unlinked slot's row alive for the next sync.
 */
import type { OpenAttachmentRemovalMarker } from "../../../data/documents/attachmentRemovalMarkerMachine";
import { planAttachmentRemovalMarkerSettlement } from "../../../data/persistence/documents/attachmentRemovalMarkerPlan";
import type {
  AttachmentRemovalMarkerSettlement,
  DocumentsPersistence,
  LocalAttachmentRecord,
  PendingAttachmentRecord,
} from "../../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";

export async function saveLocalDocumentAttachments(input: {
  attachments: ReadonlyArray<LocalAttachmentRecord>;
  execSql: ExecSql;
  persistence: DocumentsPersistence;
}): Promise<void> {
  for (const attachment of input.attachments) {
    await input.persistence.saveLocalAttachment(input.execSql, attachment);
  }
}

/**
 * Mark a slot's local blob row detached without dropping it.
 *
 * Unlinking an attachment from a synced document cannot delete the row: it is
 * also the marker `syncDetachedAttachments` needs to detach the remote binding
 * on the next sync (and to survive a restart before that sync runs). Marking it
 * keeps that marker while taking the slot out of the local blob read models
 * right away, so the blob browser stops listing a reference the document no
 * longer has.
 */
export async function markLocalDocumentAttachmentDetached(input: {
  execSql: ExecSql;
  localId: string;
  persistence: DocumentsPersistence;
  slotId: string;
  storageKey: string;
}): Promise<void> {
  await input.persistence.markLocalAttachmentDetached(
    input.execSql,
    input.localId,
    input.slotId,
    input.storageKey,
  );
}

/**
 * Settle a removal marker against committed document history: keep it owing
 * a detach, revive it as the held copy of a re-added slot, requeue its bytes
 * for a slot re-added after its binding went away, or drop it.
 */
export function settleDocumentAttachmentRemovalMarker(input: {
  execSql: ExecSql;
  from: OpenAttachmentRemovalMarker;
  localId: string;
  persistence: DocumentsPersistence;
  slotId: string;
  stillCurrent: () => boolean;
  /** The copy this device removed, as its store still maps it. */
  storageKey: string;
}): Promise<AttachmentRemovalMarkerSettlement | null> {
  const { from, storageKey } = input;
  return input.persistence.settleAttachmentRemovalMarker(input.execSql, {
    localId: input.localId,
    settle: (observed) =>
      planAttachmentRemovalMarkerSettlement({
        from,
        now: new Date().toISOString(),
        observed,
        storageKey,
      }),
    slotId: input.slotId,
    stillCurrent: input.stillCurrent,
  });
}

export async function savePendingDocumentAttachment(input: {
  attachment: PendingAttachmentRecord;
  execSql: ExecSql;
  persistence: DocumentsPersistence;
}): Promise<void> {
  await input.persistence.savePendingAttachment(
    input.execSql,
    input.attachment,
  );
}

export async function deletePendingDocumentAttachment(input: {
  execSql: ExecSql;
  localId: string;
  persistence: DocumentsPersistence;
  slotId: string;
  storageKey: string;
}): Promise<void> {
  await input.persistence.deletePendingAttachment(
    input.execSql,
    input.localId,
    input.slotId,
    input.storageKey,
  );
}

export function saveHydratedDocumentAttachment(input: {
  execSql: ExecSql;
  persistence: DocumentsPersistence;
  attachment: LocalAttachmentRecord;
  expectedStorageKey: string | null;
  expectedSnapshotEndVersion: string | null;
  stillCurrent: () => boolean;
}): Promise<boolean> {
  return input.persistence.saveHydratedAttachment(input.execSql, input);
}
