import {
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import { unionAll } from "drizzle-orm/sqlite-core";
import { ensureContainerTables } from "../../data/persistence/containers/containerPersistence";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import {
  containers,
  documentAttachmentBlobProjection,
  documentPendingAttachments,
  documentProjection,
} from "../../data/sqlite/schema";
import {
  type ClientSQLiteDatabase,
  getClientSQLitePersistenceRuntime,
} from "../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  attachBlobInfoReferences,
  mapBlobInfoReferenceRow,
  mapBlobInfoRow,
  readRequiredNumber,
} from "./blobInfoRows";
import type {
  BlobInfo,
  BlobInfoAttachmentKind,
  BlobInfoDocumentReference,
  BlobInfoInput,
  BlobInfoList,
  BlobInfoSort,
} from "./blobInfoTypes";

export type {
  BlobInfo,
  BlobInfoAttachmentKind,
  BlobInfoDocumentReference,
  BlobInfoInput,
  BlobInfoList,
  BlobInfoSort,
  BlobInfoSortDirection,
  BlobInfoSortKey,
} from "./blobInfoTypes";

const DEFAULT_BLOB_INFO_LIMIT = 200;
const MAX_BLOB_INFO_LIMIT = 999;
const DEFAULT_BLOB_INFO_SORT: BlobInfoSort = {
  direction: "desc",
  key: "updated",
};

function normalizeBlobInfoWindowValue(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
}

function normalizeBlobInfoLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_BLOB_INFO_LIMIT;
  }

  return Math.min(MAX_BLOB_INFO_LIMIT, normalizeBlobInfoWindowValue(value));
}

function normalizeBlobInfoQuery(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function normalizeBlobInfoSort(value: BlobInfoSort | undefined): BlobInfoSort {
  if (!value) {
    return DEFAULT_BLOB_INFO_SORT;
  }

  if (
    (value.direction !== "asc" && value.direction !== "desc") ||
    (value.key !== "byteLength" &&
      value.key !== "mimeType" &&
      value.key !== "updated")
  ) {
    return DEFAULT_BLOB_INFO_SORT;
  }

  return value;
}

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
      name: sql<string | null>`NULL`.as("name"),
      organizationId: sql<string | null>`COALESCE(
        NULLIF(${containers.organizationId}, ''),
        NULLIF(${documentProjection.organizationId}, '')
      )`.as("organization_id"),
      searchText: sql<string>`LOWER(
        COALESCE(${documentAttachmentBlobProjection.blobId}, '')
        || CHAR(0) || COALESCE(${documentAttachmentBlobProjection.storageKey}, '')
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
      documentProjection,
      eq(documentProjection.localId, documentAttachmentBlobProjection.localId),
    )
    .leftJoin(containers, eq(containers.id, documentProjection.containerId))
    .where(isNull(documentAttachmentBlobProjection.detachedAt));
}

function createBlobInfoReferencesCte(db: ClientSQLiteDatabase) {
  return db
    .$with("blob_info_references")
    .as(
      unionAll(
        createPendingBlobInfoReferencesSelect(db),
        createLocalBlobInfoReferencesSelect(db),
      ),
    );
}

function createGroupedBlobInfoCtes(input: {
  readonly db: ClientSQLiteDatabase;
  readonly query: string;
}) {
  const blobInfoReferences = createBlobInfoReferencesCte(input.db);
  const groupedBlobInfoSelection = {
    blobId: sql<
      string | null
    >`MIN(NULLIF(${blobInfoReferences.blobId}, ''))`.as("blob_id"),
    blobKey: blobInfoReferences.blobKey,
    byteLength: sql<number>`MAX(${blobInfoReferences.byteLength})`.as(
      "byte_length",
    ),
    changedAtSort: sql<string | null>`COALESCE(
      MAX(NULLIF(${blobInfoReferences.updatedAt}, '')),
      MIN(NULLIF(${blobInfoReferences.createdAt}, ''))
    )`.as("changed_at_sort"),
    createdAt: sql<
      string | null
    >`MIN(NULLIF(${blobInfoReferences.createdAt}, ''))`.as("created_at"),
    documentCount: countDistinct(blobInfoReferences.localId).as(
      "document_count",
    ),
    mimeType: sql<
      string | null
    >`MIN(NULLIF(${blobInfoReferences.mimeType}, ''))`.as("mime_type"),
    name: sql<string | null>`MIN(NULLIF(${blobInfoReferences.name}, ''))`.as(
      "name",
    ),
    organizationId: sql<string | null>`CASE
      WHEN COUNT(NULLIF(${blobInfoReferences.organizationId}, '')) = COUNT(*)
        AND COUNT(DISTINCT NULLIF(${blobInfoReferences.organizationId}, '')) = 1
        THEN MIN(NULLIF(${blobInfoReferences.organizationId}, ''))
      ELSE NULL
    END`.as("organization_id"),
    referenceCount: count().as("reference_count"),
    storageKey: sql<string>`MIN(${blobInfoReferences.storageKey})`.as(
      "storage_key",
    ),
    updatedAt: sql<
      string | null
    >`MAX(NULLIF(${blobInfoReferences.updatedAt}, ''))`.as("updated_at"),
  };

  if (input.query === "") {
    const groupedBlobInfo = input.db.$with("grouped_blob_info").as(
      input.db
        .select(groupedBlobInfoSelection)
        .from(blobInfoReferences)
        .groupBy(({ blobKey }) => blobKey),
    );

    return { blobInfoReferences, groupedBlobInfo, matchingBlobKeys: null };
  }

  const matchingBlobKeys = input.db.$with("matching_blob_keys").as(
    input.db
      .selectDistinct({
        matchingBlobKey: sql<string>`${blobInfoReferences.blobKey}`.as(
          "matching_blob_key",
        ),
      })
      .from(blobInfoReferences)
      .where(
        gt(
          sql<number>`INSTR(${blobInfoReferences.searchText}, ${input.query})`,
          0,
        ),
      ),
  );
  const groupedBlobInfo = input.db.$with("grouped_blob_info").as(
    input.db
      .select(groupedBlobInfoSelection)
      .from(blobInfoReferences)
      .innerJoin(
        matchingBlobKeys,
        eq(matchingBlobKeys.matchingBlobKey, blobInfoReferences.blobKey),
      )
      .groupBy(({ blobKey }) => blobKey),
  );

  return { blobInfoReferences, groupedBlobInfo, matchingBlobKeys };
}

async function countBlobInfoRows(input: {
  readonly db: ClientSQLiteDatabase;
  readonly query: string;
}): Promise<number> {
  const { blobInfoReferences, groupedBlobInfo, matchingBlobKeys } =
    createGroupedBlobInfoCtes(input);
  const rows =
    matchingBlobKeys === null
      ? await input.db
          .with(blobInfoReferences, groupedBlobInfo)
          .select({ totalCount: count().as("total_count") })
          .from(groupedBlobInfo)
      : await input.db
          .with(blobInfoReferences, matchingBlobKeys, groupedBlobInfo)
          .select({ totalCount: count().as("total_count") })
          .from(groupedBlobInfo);

  return readRequiredNumber(rows[0]?.totalCount, "total_count");
}

async function listBlobInfoRows(input: {
  readonly db: ClientSQLiteDatabase;
  readonly limit: number;
  readonly offset: number;
  readonly query: string;
  readonly sort: BlobInfoSort;
}): Promise<Array<Omit<BlobInfo, "references">>> {
  const { blobInfoReferences, groupedBlobInfo, matchingBlobKeys } =
    createGroupedBlobInfoCtes(input);
  const changedAtSortDirection =
    input.sort.direction === "desc"
      ? desc(groupedBlobInfo.changedAtSort)
      : asc(groupedBlobInfo.changedAtSort);
  const byteLengthSortDirection =
    input.sort.direction === "desc"
      ? desc(groupedBlobInfo.byteLength)
      : asc(groupedBlobInfo.byteLength);
  let orderBy: ReturnType<typeof asc | typeof desc>[];
  if (input.sort.key === "mimeType") {
    orderBy = [
      asc(sql`${groupedBlobInfo.mimeType} IS NULL`),
      input.sort.direction === "desc"
        ? desc(sql`${groupedBlobInfo.mimeType} COLLATE NOCASE`)
        : asc(sql`${groupedBlobInfo.mimeType} COLLATE NOCASE`),
      desc(groupedBlobInfo.changedAtSort),
      asc(groupedBlobInfo.blobKey),
    ];
  } else if (input.sort.key === "byteLength") {
    orderBy = [
      byteLengthSortDirection,
      desc(groupedBlobInfo.changedAtSort),
      asc(groupedBlobInfo.blobKey),
    ];
  } else {
    orderBy = [
      asc(sql`${groupedBlobInfo.changedAtSort} IS NULL`),
      changedAtSortDirection,
      asc(groupedBlobInfo.blobKey),
    ];
  }
  const selection = {
    blobId: groupedBlobInfo.blobId,
    blobKey: groupedBlobInfo.blobKey,
    byteLength: groupedBlobInfo.byteLength,
    createdAt: groupedBlobInfo.createdAt,
    documentCount: groupedBlobInfo.documentCount,
    mimeType: groupedBlobInfo.mimeType,
    name: groupedBlobInfo.name,
    organizationId: groupedBlobInfo.organizationId,
    referenceCount: groupedBlobInfo.referenceCount,
    storageKey: groupedBlobInfo.storageKey,
    updatedAt: groupedBlobInfo.updatedAt,
  };
  const rows =
    matchingBlobKeys === null
      ? await input.db
          .with(blobInfoReferences, groupedBlobInfo)
          .select(selection)
          .from(groupedBlobInfo)
          .orderBy(...orderBy)
          .limit(input.limit)
          .offset(input.offset)
      : await input.db
          .with(blobInfoReferences, matchingBlobKeys, groupedBlobInfo)
          .select(selection)
          .from(groupedBlobInfo)
          .orderBy(...orderBy)
          .limit(input.limit)
          .offset(input.offset);

  return rows.map(mapBlobInfoRow);
}

async function listBlobInfoReferencesForKeys(input: {
  readonly db: ClientSQLiteDatabase;
  readonly keys: ReadonlyArray<string>;
}): Promise<BlobInfoDocumentReference[]> {
  if (input.keys.length === 0) {
    return [];
  }

  const blobInfoReferences = createBlobInfoReferencesCte(input.db);
  const rows = await input.db
    .with(blobInfoReferences)
    .select({
      attachmentKind: blobInfoReferences.attachmentKind,
      blobId: blobInfoReferences.blobId,
      byteLength: blobInfoReferences.byteLength,
      containerId: blobInfoReferences.containerId,
      createdAt: blobInfoReferences.createdAt,
      documentId: blobInfoReferences.documentId,
      documentKind: blobInfoReferences.documentKind,
      documentTitle: blobInfoReferences.documentTitle,
      localId: blobInfoReferences.localId,
      mimeType: blobInfoReferences.mimeType,
      name: blobInfoReferences.name,
      slotId: blobInfoReferences.slotId,
      storageKey: blobInfoReferences.storageKey,
      updatedAt: blobInfoReferences.updatedAt,
    })
    .from(blobInfoReferences)
    .where(inArray(blobInfoReferences.blobKey, [...input.keys]))
    .orderBy(
      asc(blobInfoReferences.blobKey),
      desc(blobInfoReferences.changedAtSort),
      asc(blobInfoReferences.localId),
      asc(blobInfoReferences.slotId),
    );

  return rows.map(mapBlobInfoReferenceRow);
}

export async function listBlobInfo(
  input: BlobInfoInput & { readonly execSql?: ExecSql | null | undefined },
): Promise<BlobInfoList> {
  if (!input.execSql) {
    return { rows: [], totalCount: 0 };
  }

  const query = normalizeBlobInfoQuery(input.query);
  const limit = normalizeBlobInfoLimit(input.limit);
  const offset = normalizeBlobInfoWindowValue(input.offset);
  const sort = normalizeBlobInfoSort(input.sort);
  await sqlDocumentsPersistence.ensureSchema(input.execSql);
  await ensureContainerTables(input.execSql);
  const { db } = getClientSQLitePersistenceRuntime(input.execSql);

  const totalCount = await countBlobInfoRows({
    db,
    query,
  });
  if (limit === 0 || offset >= totalCount) {
    return { rows: [], totalCount };
  }

  const groupedRows = await listBlobInfoRows({
    db,
    limit,
    offset,
    query,
    sort,
  });
  const references = await listBlobInfoReferencesForKeys({
    db,
    keys: groupedRows.map((row) => row.key),
  });

  return {
    rows: attachBlobInfoReferences({ references, rows: groupedRows }),
    totalCount,
  };
}
