import { eq, isNull, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/sqlite-core";
import {
  containers,
  documentAttachmentBlobProjection,
  documentPendingAttachments,
} from "../../../data/sqlite/schema";
import {
  documentProjection,
  documentProjectionText,
} from "../../../data/sqlite/schema/documentProjectionSchema";
import type { ClientSQLiteDatabase } from "../../../data/sqlite/sqlitePersistenceRuntime";
import type { BlobInfoAttachmentKind } from "./blobInfoTypes";

function createPendingBlobInfoReferencesSelect(db: ClientSQLiteDatabase) {
  return db
    .select({
      attachmentKind: sql<BlobInfoAttachmentKind>`'pending'`.as(
        "attachment_kind",
      ),
      blobId: sql<string | null>`NULL`.as("blob_id"),
      blobKey:
        sql<string>`'storage:' || ${documentPendingAttachments.storageKey}`.as(
          "blob_key",
        ),
      byteLength: documentPendingAttachments.byteLength,
      changedAtSort: sql<string>`${documentPendingAttachments.createdAt}`.as(
        "changed_at_sort",
      ),
      containerId: documentProjection.containerId,
      createdAt: sql<string | null>`${documentPendingAttachments.createdAt}`.as(
        "created_at",
      ),
      documentId: documentProjection.documentId,
      documentKind: documentProjection.documentKind,
      documentTitle: documentProjection.title,
      localId: documentPendingAttachments.localId,
      mimeType: documentPendingAttachments.mimeType,
      name: sql<string | null>`${documentPendingAttachments.name}`.as("name"),
      organizationId: sql<string | null>`COALESCE(
        NULLIF(${containers.organizationId}, ''),
        NULLIF(${documentProjection.organizationId}, '')
      )`.as("organization_id"),
      searchText: sql<string>`LOWER(
        COALESCE(${documentPendingAttachments.storageKey}, '')
        || CHAR(0) || COALESCE(${documentPendingAttachments.mimeType}, '')
        || CHAR(0) || COALESCE(${documentPendingAttachments.name}, '')
        || CHAR(0) || COALESCE(${documentPendingAttachments.localId}, '')
        || CHAR(0) || COALESCE(${documentProjection.documentId}, '')
        || CHAR(0) || COALESCE(${documentProjection.title}, '')
        || CHAR(0) || COALESCE(${documentProjection.containerId}, '')
        || CHAR(0) || COALESCE(
          NULLIF(${containers.organizationId}, ''),
          NULLIF(${documentProjection.organizationId}, ''),
          ''
        )
        || CHAR(0) || COALESCE(${documentPendingAttachments.slotId}, '')
      )`.as("search_text"),
      slotId: documentPendingAttachments.slotId,
      storageKey: documentPendingAttachments.storageKey,
      updatedAt: sql<string | null>`NULL`.as("updated_at"),
    })
    .from(documentPendingAttachments)
    .leftJoin(
      documentProjection,
      eq(documentProjection.localId, documentPendingAttachments.localId),
    )
    .leftJoin(containers, eq(containers.id, documentProjection.containerId));
}

// Detached rows are excluded here rather than at each call site: a slot unlinked
// from a synced document keeps its row until the detach reaches the server, and
// it stops being a reference the moment it is unlinked.
function createLocalBlobInfoReferencesSelect(db: ClientSQLiteDatabase) {
  const path = sql`'$.' || json_quote(${documentAttachmentBlobProjection.contentSha256} || ':' || ${documentAttachmentBlobProjection.slotId})`;
  const names = documentProjectionText.attachmentNames;
  return db
    .select({
      attachmentKind: sql<BlobInfoAttachmentKind>`'local'`.as(
        "attachment_kind",
      ),
      blobId: documentAttachmentBlobProjection.blobId,
      blobKey: sql<string>`CASE
        WHEN ${documentAttachmentBlobProjection.blobId} IS NOT NULL
          AND ${documentAttachmentBlobProjection.blobId} <> ''
          THEN 'blob:' || ${documentAttachmentBlobProjection.blobId}
        ELSE 'storage:' || ${documentAttachmentBlobProjection.storageKey}
      END`.as("blob_key"),
      byteLength: documentAttachmentBlobProjection.byteLength,
      changedAtSort:
        sql<string>`${documentAttachmentBlobProjection.updatedAt}`.as(
          "changed_at_sort",
        ),
      containerId: documentProjection.containerId,
      createdAt: sql<string | null>`NULL`.as("created_at"),
      documentId: documentProjection.documentId,
      documentKind: documentProjection.documentKind,
      documentTitle: documentProjection.title,
      localId: documentAttachmentBlobProjection.localId,
      mimeType: documentAttachmentBlobProjection.mimeType,
      name: sql<string | null>`json_extract(${names}, ${path} || '.name')`.as(
        "name",
      ),
      organizationId: sql<string | null>`COALESCE(
        NULLIF(${containers.organizationId}, ''),
        NULLIF(${documentProjection.organizationId}, '')
      )`.as("organization_id"),
      searchText: sql<string>`LOWER(
        COALESCE(${documentAttachmentBlobProjection.blobId}, '')
        || CHAR(0) || COALESCE(${documentAttachmentBlobProjection.storageKey}, '')
        || CHAR(0) || COALESCE(json_extract(${names}, ${path} || '.search'), '')
        || CHAR(0) || COALESCE(${documentAttachmentBlobProjection.mimeType}, '')
        || CHAR(0) || COALESCE(${documentAttachmentBlobProjection.localId}, '')
        || CHAR(0) || COALESCE(${documentProjection.documentId}, '')
        || CHAR(0) || COALESCE(${documentProjection.title}, '')
        || CHAR(0) || COALESCE(${documentProjection.containerId}, '')
        || CHAR(0) || COALESCE(
          NULLIF(${containers.organizationId}, ''),
          NULLIF(${documentProjection.organizationId}, ''),
          ''
        )
        || CHAR(0) || COALESCE(${documentAttachmentBlobProjection.slotId}, '')
      )`.as("search_text"),
      slotId: documentAttachmentBlobProjection.slotId,
      storageKey: documentAttachmentBlobProjection.storageKey,
      updatedAt: sql<
        string | null
      >`${documentAttachmentBlobProjection.updatedAt}`.as("updated_at"),
    })
    .from(documentAttachmentBlobProjection)
    .leftJoin(
      documentProjectionText,
      eq(
        documentProjectionText.localId,
        documentAttachmentBlobProjection.localId,
      ),
    )
    .leftJoin(
      documentProjection,
      eq(documentProjection.localId, documentAttachmentBlobProjection.localId),
    )
    .leftJoin(containers, eq(containers.id, documentProjection.containerId))
    .where(isNull(documentAttachmentBlobProjection.detachedAt));
}

export function createBlobInfoReferencesCte(db: ClientSQLiteDatabase) {
  return db
    .$with("blob_info_references")
    .as(
      unionAll(
        createPendingBlobInfoReferencesSelect(db),
        createLocalBlobInfoReferencesSelect(db),
      ),
    );
}
