import { ensureContainerTables } from "../../data/persistence/containers/containerPersistence";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { emptyContentFrontierSql } from "./documentQueries/hydrationSql";

export interface PendingDownloadQueueItem {
  localId: string;
  documentId: string;
  objectKind: "document" | "container";
  /** Null until content supplies a reliable title and type. */
  title: string | null;
  reason: "initial" | "continuation";
  lastError: string | null;
}

/** Durable, already-discovered content pulls, including folder metadata. */
export async function listPendingDownloads(
  execSql: ExecSql,
): Promise<ReadonlyArray<PendingDownloadQueueItem>> {
  await ensureContainerTables(execSql);
  await sqlDocumentsPersistence.ensureSchema(execSql);
  const rows = await execSql(`
    SELECT stored.local_id, stored.document_id, stored.app_kind,
      CASE WHEN ${emptyContentFrontierSql("stored")} THEN NULL
        WHEN stored.app_kind = 'documents' THEN d.title
        ELSE c.display_name END AS title,
      CASE WHEN ${emptyContentFrontierSql("stored")} THEN 'initial'
        ELSE 'continuation' END AS reason,
      failure.message AS last_error
    FROM documents stored
    LEFT JOIN document_projection d ON stored.app_kind = 'documents'
      AND d.local_id = stored.local_id
    LEFT JOIN containers folder ON stored.app_kind = 'container-metadata'
      AND folder.id = stored.local_id
    LEFT JOIN container_projection c ON c.container_id = folder.id
    LEFT JOIN document_sync_failures failure ON failure.app_kind = stored.app_kind
      AND failure.local_id = stored.local_id
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
    const item: PendingDownloadQueueItem = {
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
