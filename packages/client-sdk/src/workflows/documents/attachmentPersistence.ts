/**
 * Attachment-slot persistence for stored documents.
 *
 * These are the workflow-level seams the document store writes attachment rows
 * through: the pending-upload queue, the local blob projection, and the detach
 * marker that keeps an unlinked slot's row alive for the next sync.
 */
import type {
  DocumentsPersistence,
  LocalAttachmentRecord,
  PendingAttachmentRecord,
} from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

export async function saveLocalDocumentAttachments(input: {
  attachments: ReadonlyArray<LocalAttachmentRecord>;
  execSql: ExecSql;
  persistence: DocumentsPersistence;
}): Promise<void> {
  for (const attachment of input.attachments) {
    await input.persistence.saveLocalAttachment(input.execSql, attachment);
  }
}

export async function deleteLocalDocumentAttachment(input: {
  execSql: ExecSql;
  localId: string;
  persistence: DocumentsPersistence;
  slotId: string;
  storageKey: string;
}): Promise<void> {
  await input.persistence.deleteLocalAttachment(
    input.execSql,
    input.localId,
    input.slotId,
    input.storageKey,
  );
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
