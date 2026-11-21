import { ensureContainerTables } from "../../../data/persistence/container-contents/containerPersistence";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { emptyContentFrontierSql } from "./hydrationSql";

interface PendingContentDownload {
  localId: string;
  documentId: string;
  objectKind: "document" | "container";
  /** Null until content supplies a reliable title and type. */
  title: string | null;
  reason: "initial" | "continuation";
  lastError: string | null;
}

/**
 * The first download of a file a synced document records for a slot. The row
 * carries the identity hydration fetches with: the slot and the stored
 * record's document id.
 */
interface PendingAttachmentDownload {
  localId: string;
  documentId: string;
  objectKind: "attachment";
  /** The owning document's projected title. */
  title: string;
  reason: "initial";
  lastError: string | null;
  slotId: string;
  fileName: string;
}

export type PendingDownloadQueueItem =
  | PendingContentDownload
  | PendingAttachmentDownload;

/**
 * Durable, already-discovered content pulls, including folder metadata, then
 * the first downloads of files recorded by synced documents.
 */
export async function listPendingDownloads(
  execSql: ExecSql,
): Promise<ReadonlyArray<PendingDownloadQueueItem>> {
  await ensureContainerTables(execSql);
  await sqlDocumentsPersistence.ensureSchema(execSql);
  const contentDownloads = await listPendingContentDownloads(execSql);
  const attachmentDownloads = await listPendingAttachmentDownloads(execSql);
  return [...contentDownloads, ...attachmentDownloads];
}

async function listPendingContentDownloads(
  execSql: ExecSql,
): Promise<ReadonlyArray<PendingContentDownload>> {
  const rows = await execSql(`
    SELECT stored.local_id, stored.document_id, stored.app_kind,
      CASE WHEN ${emptyContentFrontierSql("stored")} THEN NULL
        WHEN stored.app_kind = 'documents' THEN d.title
        ELSE folder.display_name END AS title,
      CASE WHEN ${emptyContentFrontierSql("stored")} THEN 'initial'
        ELSE 'continuation' END AS reason,
      stored.sync_failure_message AS last_error
    FROM documents stored
    LEFT JOIN document_projection d ON stored.app_kind = 'documents'
      AND d.local_id = stored.local_id
    LEFT JOIN containers folder ON stored.app_kind = 'container-metadata'
      AND folder.id = stored.local_id
    WHERE stored.document_id IS NOT NULL
      AND (${emptyContentFrontierSql("stored")} OR stored.pull_continuation IS NOT NULL)
      AND ((stored.app_kind = 'documents' AND d.local_id IS NOT NULL)
        OR (stored.app_kind = 'container-metadata' AND folder.id IS NOT NULL))
    ORDER BY stored.updated_at, stored.app_kind, stored.local_id
  `);
  return rows.flatMap((row) => {
    const {
      local_id: localId,
      document_id: documentId,
      app_kind: appKind,
      title,
      reason,
      last_error: lastError,
    } = row;
    if (typeof localId !== "string" || typeof documentId !== "string")
      return [];
    const item: PendingContentDownload = {
      localId,
      documentId,
      objectKind: appKind === "documents" ? "document" : "container",
      title: typeof title === "string" ? title : null,
      reason: reason === "initial" ? "initial" : "continuation",
      lastError: typeof lastError === "string" ? lastError : null,
    };
    return [item];
  });
}

// `attachment_names` keys each slot recorded by the content as
// `<contentSha256>:<slotId>`; the hex digest never contains a colon, while a
// collection slot id (`photos:<uuid>`) can. Any local row for the slot, held
// or awaiting a remote detach, means this is no longer a first download, and a
// pending upload is this device's own file.
async function listPendingAttachmentDownloads(
  execSql: ExecSql,
): Promise<ReadonlyArray<PendingAttachmentDownload>> {
  const rows = await execSql(`
    SELECT stored.local_id, stored.document_id, d.title,
      stored.sync_failure_message AS last_error,
      substr(recorded.key, instr(recorded.key, ':') + 1) AS slot_id,
      json_extract(recorded.value, '$.name') AS file_name
    FROM documents stored
    JOIN document_projection d ON d.local_id = stored.local_id
    JOIN document_projection_text projected
      ON projected.local_id = stored.local_id
    JOIN json_each(projected.attachment_names) recorded
    WHERE stored.app_kind = 'documents'
      AND stored.document_id IS NOT NULL
      AND NOT ${emptyContentFrontierSql("stored")}
      AND projected.attachment_names IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM document_attachment_blob_projection held
        WHERE held.local_id = stored.local_id
          AND held.slot_id = substr(recorded.key, instr(recorded.key, ':') + 1)
      )
      AND NOT EXISTS (
        SELECT 1 FROM document_pending_attachments upload
        WHERE upload.local_id = stored.local_id
          AND upload.slot_id = substr(recorded.key, instr(recorded.key, ':') + 1)
      )
    ORDER BY stored.updated_at, stored.local_id, slot_id
  `);
  return rows.flatMap((row) => {
    const {
      local_id: localId,
      document_id: documentId,
      title,
      last_error: lastError,
      slot_id: slotId,
      file_name: fileName,
    } = row;
    if (
      typeof localId !== "string" ||
      typeof documentId !== "string" ||
      typeof title !== "string" ||
      typeof slotId !== "string" ||
      slotId.length === 0 ||
      typeof fileName !== "string"
    )
      return [];
    const item: PendingAttachmentDownload = {
      localId,
      documentId,
      objectKind: "attachment",
      title,
      reason: "initial",
      lastError: typeof lastError === "string" ? lastError : null,
      slotId,
      fileName,
    };
    return [item];
  });
}
