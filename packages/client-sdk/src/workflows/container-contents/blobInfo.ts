import {
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gt,
  inArray,
  sql,
} from "drizzle-orm";
import { unionAll } from "drizzle-orm/sqlite-core";
import type { StoredDocumentKind } from "../../data/documents/documentKinds";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import {
  documentAttachmentBlobProjection,
  documentPendingAttachments,
  documentProjection,
} from "../../data/sqlite/schema";
import {
  type ClientSQLiteDatabase,
  getClientSQLitePersistenceRuntime,
} from "../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

export type BlobInfoAttachmentKind = "local" | "pending";
export type BlobInfoSortDirection = "asc" | "desc";
export type BlobInfoSortKey = "mimeType" | "updated";

export interface BlobInfoSort {
  readonly direction: BlobInfoSortDirection;
  readonly key: BlobInfoSortKey;
}

export interface BlobInfoDocumentReference {
  readonly attachmentKind: BlobInfoAttachmentKind;
  readonly blobId: string | null;
  readonly byteLength: number;
  readonly containerId: string | null;
  readonly createdAt: string | null;
  readonly documentId: string | null;
  readonly documentKind: StoredDocumentKind | null;
  readonly documentTitle: string | null;
  readonly localId: string;
  readonly mimeType: string | null;
  readonly name: string | null;
  readonly slotId: string;
  readonly storageKey: string;
  readonly updatedAt: string | null;
}

export interface BlobInfo {
  readonly blobId: string | null;
  readonly byteLength: number;
  readonly createdAt: string | null;
  readonly documentCount: number;
  readonly key: string;
  readonly mimeType: string | null;
  readonly name: string | null;
  readonly referenceCount: number;
  readonly references: ReadonlyArray<BlobInfoDocumentReference>;
  readonly storageKey: string;
  readonly updatedAt: string | null;
}

export interface BlobInfoList {
  readonly rows: ReadonlyArray<BlobInfo>;
  readonly totalCount: number;
}

export interface BlobInfoInput {
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly query?: string | undefined;
  readonly sort?: BlobInfoSort | undefined;
}

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
    (value.key !== "mimeType" && value.key !== "updated")
  ) {
    return DEFAULT_BLOB_INFO_SORT;
  }

  return value;
}

function getBlobInfoKey(
  reference: Pick<BlobInfoDocumentReference, "blobId" | "storageKey">,
): string {
  return reference.blobId
    ? `blob:${reference.blobId}`
    : `storage:${reference.storageKey}`;
}

interface BlobInfoReferenceRow {
  readonly attachmentKind: BlobInfoAttachmentKind;
  readonly blobId: string | null;
  readonly byteLength: number;
  readonly containerId: string | null;
  readonly createdAt: string | null;
  readonly documentId: string | null;
  readonly documentKind: string | null;
  readonly documentTitle: string | null;
  readonly localId: string;
  readonly mimeType: string | null;
  readonly name: string | null;
  readonly slotId: string;
  readonly storageKey: string;
  readonly updatedAt: string | null;
}

interface GroupedBlobInfoRow {
  readonly blobId: string | null;
  readonly blobKey: string;
  readonly byteLength: number;
  readonly createdAt: string | null;
  readonly documentCount: number;
  readonly mimeType: string | null;
  readonly name: string | null;
  readonly referenceCount: number;
  readonly storageKey: string;
  readonly updatedAt: string | null;
}

function readNullableString(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readRequiredString(
  value: string | null | undefined,
  key: string,
): string {
  const normalizedValue = readNullableString(value);
  if (!normalizedValue) {
    throw new Error(`Blob info row is missing ${key}.`);
  }

  return normalizedValue;
}

function readRequiredNumber(value: number | null | undefined, key: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Blob info row is missing ${key}.`);
  }

  return value;
}

function mapBlobInfoReferenceRow(
  row: BlobInfoReferenceRow,
): BlobInfoDocumentReference {
  return {
    attachmentKind: row.attachmentKind,
    blobId: readNullableString(row.blobId),
    byteLength: readRequiredNumber(row.byteLength, "byte_length"),
    containerId: readNullableString(row.containerId),
    createdAt: readNullableString(row.createdAt),
    documentId: readNullableString(row.documentId),
    documentKind: readNullableString(
      row.documentKind,
    ) as StoredDocumentKind | null,
    documentTitle: readNullableString(row.documentTitle),
    localId: readRequiredString(row.localId, "local_id"),
    mimeType: readNullableString(row.mimeType),
    name: readNullableString(row.name),
    slotId: readRequiredString(row.slotId, "slot_id"),
    storageKey: readRequiredString(row.storageKey, "storage_key"),
    updatedAt: readNullableString(row.updatedAt),
  };
}

function mapBlobInfoRow(row: GroupedBlobInfoRow): Omit<BlobInfo, "references"> {
  return {
    blobId: readNullableString(row.blobId),
    byteLength: readRequiredNumber(row.byteLength, "byte_length"),
    createdAt: readNullableString(row.createdAt),
    documentCount: readRequiredNumber(row.documentCount, "document_count"),
    key: readRequiredString(row.blobKey, "blob_key"),
    mimeType: readNullableString(row.mimeType),
    name: readNullableString(row.name),
    referenceCount: readRequiredNumber(row.referenceCount, "reference_count"),
    storageKey: readRequiredString(row.storageKey, "storage_key"),
    updatedAt: readNullableString(row.updatedAt),
  };
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
      containerId: sql<string | null>`${documentProjection.containerId}`.as(
        "container_id",
      ),
      createdAt: sql<string | null>`${documentPendingAttachments.createdAt}`.as(
        "created_at",
      ),
      documentId: sql<string | null>`${documentProjection.documentId}`.as(
        "document_id",
      ),
      documentKind:
        sql<StoredDocumentKind | null>`${documentProjection.documentKind}`.as(
          "document_kind",
        ),
      documentTitle: sql<string | null>`${documentProjection.title}`.as(
        "document_title",
      ),
      localId: documentPendingAttachments.localId,
      mimeType: documentPendingAttachments.mimeType,
      name: sql<string | null>`${documentPendingAttachments.name}`.as("name"),
      searchText: sql<string>`LOWER(
        COALESCE(${documentPendingAttachments.storageKey}, '')
        || CHAR(0) || COALESCE(${documentPendingAttachments.mimeType}, '')
        || CHAR(0) || COALESCE(${documentPendingAttachments.name}, '')
        || CHAR(0) || COALESCE(${documentPendingAttachments.localId}, '')
        || CHAR(0) || COALESCE(${documentProjection.documentId}, '')
        || CHAR(0) || COALESCE(${documentProjection.title}, '')
        || CHAR(0) || COALESCE(${documentProjection.containerId}, '')
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
    );
}

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
      containerId: sql<string | null>`${documentProjection.containerId}`.as(
        "container_id",
      ),
      createdAt: sql<string | null>`NULL`.as("created_at"),
      documentId: sql<string | null>`${documentProjection.documentId}`.as(
        "document_id",
      ),
      documentKind:
        sql<StoredDocumentKind | null>`${documentProjection.documentKind}`.as(
          "document_kind",
        ),
      documentTitle: sql<string | null>`${documentProjection.title}`.as(
        "document_title",
      ),
      localId: documentAttachmentBlobProjection.localId,
      mimeType: documentAttachmentBlobProjection.mimeType,
      name: sql<string | null>`NULL`.as("name"),
      searchText: sql<string>`LOWER(
        COALESCE(${documentAttachmentBlobProjection.blobId}, '')
        || CHAR(0) || COALESCE(${documentAttachmentBlobProjection.storageKey}, '')
        || CHAR(0) || COALESCE(${documentAttachmentBlobProjection.mimeType}, '')
        || CHAR(0) || COALESCE(${documentAttachmentBlobProjection.localId}, '')
        || CHAR(0) || COALESCE(${documentProjection.documentId}, '')
        || CHAR(0) || COALESCE(${documentProjection.title}, '')
        || CHAR(0) || COALESCE(${documentProjection.containerId}, '')
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
    );
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
  const matchingBlobKeys = input.db.$with("matching_blob_keys").as(
    input.db
      .selectDistinct({
        matchingBlobKey: sql<string>`${blobInfoReferences.blobKey}`.as(
          "matching_blob_key",
        ),
      })
      .from(blobInfoReferences)
      .where(
        input.query === ""
          ? undefined
          : gt(
              sql<number>`INSTR(${blobInfoReferences.searchText}, ${input.query})`,
              0,
            ),
      ),
  );
  const groupedBlobInfo = input.db.$with("grouped_blob_info").as(
    input.db
      .select({
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
        name: sql<
          string | null
        >`MIN(NULLIF(${blobInfoReferences.name}, ''))`.as("name"),
        referenceCount: count().as("reference_count"),
        storageKey: sql<string>`MIN(${blobInfoReferences.storageKey})`.as(
          "storage_key",
        ),
        updatedAt: sql<
          string | null
        >`MAX(NULLIF(${blobInfoReferences.updatedAt}, ''))`.as("updated_at"),
      })
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
  const rows = await input.db
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
  const orderBy =
    input.sort.key === "mimeType"
      ? [
          asc(sql`${groupedBlobInfo.mimeType} IS NULL`),
          input.sort.direction === "desc"
            ? desc(sql`${groupedBlobInfo.mimeType} COLLATE NOCASE`)
            : asc(sql`${groupedBlobInfo.mimeType} COLLATE NOCASE`),
          desc(groupedBlobInfo.changedAtSort),
          asc(groupedBlobInfo.blobKey),
        ]
      : [
          asc(sql`${groupedBlobInfo.changedAtSort} IS NULL`),
          changedAtSortDirection,
          asc(groupedBlobInfo.blobKey),
        ];
  const rows = await input.db
    .with(blobInfoReferences, matchingBlobKeys, groupedBlobInfo)
    .select({
      blobId: groupedBlobInfo.blobId,
      blobKey: groupedBlobInfo.blobKey,
      byteLength: groupedBlobInfo.byteLength,
      createdAt: groupedBlobInfo.createdAt,
      documentCount: groupedBlobInfo.documentCount,
      mimeType: groupedBlobInfo.mimeType,
      name: groupedBlobInfo.name,
      referenceCount: groupedBlobInfo.referenceCount,
      storageKey: groupedBlobInfo.storageKey,
      updatedAt: groupedBlobInfo.updatedAt,
    })
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

function attachBlobInfoReferences(input: {
  readonly references: ReadonlyArray<BlobInfoDocumentReference>;
  readonly rows: ReadonlyArray<Omit<BlobInfo, "references">>;
}): BlobInfo[] {
  const referencesByBlobKey = new Map<string, BlobInfoDocumentReference[]>();

  for (const reference of input.references) {
    const key = getBlobInfoKey(reference);
    const references = referencesByBlobKey.get(key);
    if (references) {
      references.push(reference);
    } else {
      referencesByBlobKey.set(key, [reference]);
    }
  }

  return input.rows.map((row) => ({
    ...row,
    references: referencesByBlobKey.get(row.key) ?? [],
  }));
}

export async function listBlobInfo(input: {
  readonly execSql?: ExecSql | null | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly query?: string | undefined;
  readonly sort?: BlobInfoSort | undefined;
}): Promise<BlobInfoList> {
  if (!input.execSql) {
    return { rows: [], totalCount: 0 };
  }

  const query = normalizeBlobInfoQuery(input.query);
  const limit = normalizeBlobInfoLimit(input.limit);
  const offset = normalizeBlobInfoWindowValue(input.offset);
  const sort = normalizeBlobInfoSort(input.sort);
  await sqlDocumentsPersistence.ensureSchema(input.execSql);
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
