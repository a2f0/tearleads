import { emptyVersionVector } from "@tearleads/loro";
import { and, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { DOCUMENTS_APP_KIND } from "../../../data/documents/documentConstants";
import { ensureContainerTables } from "../../../data/persistence/container-contents/containerPersistence";
import { CONTAINER_METADATA_APP_KIND } from "../../../data/persistence/container-contents/dormantContainerMetadata";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { containers } from "../../../data/sqlite/schema/containerSchema";
import { documentAttachmentBlobProjection } from "../../../data/sqlite/schema/documentAttachmentSchema";
import { documentProjection } from "../../../data/sqlite/schema/documentProjectionSchema";
import { documents } from "../../../data/sqlite/schema/documentRecordSchema";
import { sqliteRowsPerStatement } from "../../../data/sqlite/sqliteBindBudget";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";

/**
 * Names one row of the download queue. A local id is unique per kind, and a
 * file download is one slot of its document.
 */
export type DownloadQueueItemRef =
  | { localId: string; objectKind: "document" | "container" }
  | { localId: string; objectKind: "attachment"; slotId: string };

/**
 * A pull that left the download queue with its content fully stored, with
 * where a host can show it: a document's projected container (null when it
 * is orphaned), and a file's stored blob.
 */
export type CompletedDownloadItem =
  | {
      localId: string;
      documentId: string;
      objectKind: "document";
      title: string | null;
      containerId: string | null;
    }
  | {
      localId: string;
      documentId: string;
      objectKind: "container";
      title: string | null;
    }
  | {
      localId: string;
      documentId: string;
      objectKind: "attachment";
      slotId: string;
      /** The owning document's projected title. */
      title: string;
      /** The owning document's projected container. */
      containerId: string | null;
      storageKey: string;
      /** Null until the server blob identity is known. */
      blobId: string | null;
    };

// Each content statement also binds the two app kinds twice and both empty
// frontiers; each file statement binds the documents app kind once.
const COMPLETED_CONTENT_BATCH_SIZE = sqliteRowsPerStatement(1, 6);
const COMPLETED_ATTACHMENT_BATCH_SIZE = sqliteRowsPerStatement(1, 1);

function downloadQueueItemKey(ref: DownloadQueueItemRef): string {
  return ref.objectKind === "attachment"
    ? `attachment:${ref.localId}:${ref.slotId}`
    : `${ref.objectKind}:${ref.localId}`;
}

function batches<T>(values: ReadonlyArray<T>, size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size)
    result.push(values.slice(offset, offset + size));
  return result;
}

/**
 * Of the given queue rows, those whose content is now fully stored. A document
 * or folder still names its server document, its content frontier is not
 * empty, no page remains, and its projection exists. A file's slot holds a
 * local copy that is not detached. A row that left the queue because it was
 * deleted, detached, or reset is not returned.
 */
export async function listCompletedDownloads(
  execSql: ExecSql,
  refs: ReadonlyArray<DownloadQueueItemRef>,
): Promise<ReadonlyArray<CompletedDownloadItem>> {
  if (refs.length === 0) return [];
  await ensureContainerTables(execSql);
  await sqlDocumentsPersistence.ensureSchema(execSql);
  const wanted = new Set(refs.map(downloadQueueItemKey));
  const contentIds = new Set<string>();
  const attachmentIds = new Set<string>();
  for (const ref of refs) {
    (ref.objectKind === "attachment" ? attachmentIds : contentIds).add(
      ref.localId,
    );
  }
  const completed: CompletedDownloadItem[] = [];
  for (const batch of batches([...contentIds], COMPLETED_CONTENT_BATCH_SIZE))
    completed.push(...(await selectCompletedContent(execSql, batch)));
  for (const batch of batches(
    [...attachmentIds],
    COMPLETED_ATTACHMENT_BATCH_SIZE,
  ))
    completed.push(...(await selectCompletedAttachments(execSql, batch)));
  // A local id names one row per kind and many file slots; keep only the
  // rows asked for.
  return completed.filter((item) => wanted.has(downloadQueueItemKey(item)));
}

async function selectCompletedContent(
  execSql: ExecSql,
  localIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<CompletedDownloadItem>> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({
      appKind: documents.appKind,
      containerId: documentProjection.containerId,
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
  return rows.flatMap((row): CompletedDownloadItem[] => {
    if (row.documentId === null) return [];
    return [
      row.appKind === CONTAINER_METADATA_APP_KIND
        ? {
            documentId: row.documentId,
            localId: row.localId,
            objectKind: "container",
            title: row.folderName,
          }
        : {
            containerId: row.containerId,
            documentId: row.documentId,
            localId: row.localId,
            objectKind: "document",
            title: row.documentTitle,
          },
    ];
  });
}

async function selectCompletedAttachments(
  execSql: ExecSql,
  localIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<CompletedDownloadItem>> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({
      blobId: documentAttachmentBlobProjection.blobId,
      containerId: documentProjection.containerId,
      documentId: documents.documentId,
      localId: documentAttachmentBlobProjection.localId,
      slotId: documentAttachmentBlobProjection.slotId,
      storageKey: documentAttachmentBlobProjection.storageKey,
      title: documentProjection.title,
    })
    .from(documentAttachmentBlobProjection)
    .innerJoin(
      documents,
      and(
        eq(documents.appKind, DOCUMENTS_APP_KIND),
        eq(documents.localId, documentAttachmentBlobProjection.localId),
      ),
    )
    .innerJoin(
      documentProjection,
      eq(documentProjection.localId, documentAttachmentBlobProjection.localId),
    )
    .where(
      and(
        inArray(documentAttachmentBlobProjection.localId, [...localIds]),
        // A detached slot is a removal still waiting to reach the server.
        isNull(documentAttachmentBlobProjection.detachedAt),
        isNotNull(documents.documentId),
      ),
    );
  return rows.flatMap((row): CompletedDownloadItem[] =>
    row.documentId === null
      ? []
      : [
          {
            blobId: row.blobId,
            containerId: row.containerId,
            documentId: row.documentId,
            localId: row.localId,
            objectKind: "attachment",
            slotId: row.slotId,
            storageKey: row.storageKey,
            title: row.title,
          },
        ],
  );
}
