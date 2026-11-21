import { emptyVersionVector } from "@tearleads/loro";
import { and, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { DOCUMENTS_APP_KIND } from "../../../data/documents/documentConstants";
import { ensureContainerTables } from "../../../data/persistence/container-contents/containerPersistence";
import { CONTAINER_METADATA_APP_KIND } from "../../../data/persistence/container-contents/dormantContainerMetadata";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { containers } from "../../../data/sqlite/schema/containerSchema";
import { documentProjection } from "../../../data/sqlite/schema/documentProjectionSchema";
import { documents } from "../../../data/sqlite/schema/documentRecordSchema";
import { sqliteRowsPerStatement } from "../../../data/sqlite/sqliteBindBudget";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { emptyContentFrontierSql } from "./hydrationSql";

export interface PendingDownloadQueueItem {
  localId: string;
  documentId: string;
  objectKind: "document" | "container";
  /** Null until content supplies a reliable title and type. */
  title: string | null;
  reason: "initial" | "continuation";
  lastError: string | null;
}

/** A pull that left the download queue with its content fully stored. */
export interface CompletedDownloadItem {
  localId: string;
  documentId: string;
  objectKind: PendingDownloadQueueItem["objectKind"];
  title: string | null;
}

/** Names one row of the download queue: a local id is unique per kind. */
export type DownloadQueueItemRef = Pick<
  PendingDownloadQueueItem,
  "localId" | "objectKind"
>;

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

// Each statement also binds the two app kinds twice and both empty frontiers.
const COMPLETED_DOWNLOAD_BATCH_SIZE = sqliteRowsPerStatement(1, 6);

/**
 * Of the given queue rows, those whose content is now fully stored: the record
 * still names its server document, its content frontier is not empty, no page
 * remains, and its projection exists. A row that left the queue for another
 * reason (deleted, relinked, reset) is not returned.
 */
export async function listCompletedDownloads(
  execSql: ExecSql,
  refs: ReadonlyArray<DownloadQueueItemRef>,
): Promise<ReadonlyArray<CompletedDownloadItem>> {
  if (refs.length === 0) return [];
  await ensureContainerTables(execSql);
  await sqlDocumentsPersistence.ensureSchema(execSql);
  const wanted = new Set(refs.map(downloadQueueItemKey));
  const localIds = Array.from(new Set(refs.map((ref) => ref.localId)));
  const completed: CompletedDownloadItem[] = [];
  for (
    let offset = 0;
    offset < localIds.length;
    offset += COMPLETED_DOWNLOAD_BATCH_SIZE
  ) {
    const batch = await selectCompletedDownloads(
      execSql,
      localIds.slice(offset, offset + COMPLETED_DOWNLOAD_BATCH_SIZE),
    );
    // A local id names one row per kind; keep only the kinds asked for.
    completed.push(
      ...batch.filter((item) => wanted.has(downloadQueueItemKey(item))),
    );
  }
  return completed;
}

async function selectCompletedDownloads(
  execSql: ExecSql,
  localIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<CompletedDownloadItem>> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({
      appKind: documents.appKind,
      documentId: documents.documentId,
      documentTitle: documentProjection.title,
      folderName: containers.displayName,
      localId: documents.localId,
    })
    .from(documents)
    .leftJoin(
      documentProjection,
      and(
        eq(documents.appKind, DOCUMENTS_APP_KIND),
        eq(documentProjection.localId, documents.localId),
      ),
    )
    .leftJoin(
      containers,
      and(
        eq(documents.appKind, CONTAINER_METADATA_APP_KIND),
        eq(containers.id, documents.localId),
      ),
    )
    // The app-kind branches below let SQLite search the (app_kind, local_id)
    // primary key for each id instead of scanning.
    .where(
      and(
        inArray(documents.localId, [...localIds]),
        isNotNull(documents.documentId),
        isNull(documents.pullContinuation),
        // The negation of `emptyContentFrontierSql`, which the queue reads.
        ne(documents.snapshotEndVersion, ""),
        or(
          and(
            eq(documents.appKind, DOCUMENTS_APP_KIND),
            isNotNull(documentProjection.localId),
          ),
          and(
            eq(documents.appKind, CONTAINER_METADATA_APP_KIND),
            ne(documents.snapshotEndVersion, emptyVersionVector()),
            isNotNull(containers.id),
          ),
        ),
      ),
    );
  return rows.flatMap((row) => {
    if (row.documentId === null) return [];
    const folder = row.appKind === CONTAINER_METADATA_APP_KIND;
    const item: CompletedDownloadItem = {
      documentId: row.documentId,
      localId: row.localId,
      objectKind: folder ? "container" : "document",
      title: folder ? row.folderName : row.documentTitle,
    };
    return [item];
  });
}

function downloadQueueItemKey(ref: DownloadQueueItemRef): string {
  return `${ref.objectKind}:${ref.localId}`;
}
