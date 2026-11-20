import { asc, count, countDistinct, desc, eq, inArray, sql } from "drizzle-orm";
import { ensureContainerTables } from "../../../data/persistence/container-contents/containerPersistence";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import {
  type ClientSQLiteDatabase,
  getClientSQLitePersistenceRuntime,
} from "../../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { backfillDocumentAttachmentNames } from "../../documents";
import { createBlobInfoReferencesCte } from "./blobInfoReferenceQuery";
import {
  attachBlobInfoReferences,
  mapBlobInfoReferenceRow,
  mapBlobInfoRow,
  readRequiredNumber,
} from "./blobInfoRows";
import type {
  BlobInfo,
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

  const folded = input.query.toLowerCase();
  const search = blobInfoReferences.searchText;
  const foldedMatch = sql`INSTR(${search}, ${folded})`;
  // SQLite folds only ASCII. Also match its spelling of a verbatim filename.
  const matchingBlobKeys = input.db.$with("matching_blob_keys").as(
    input.db
      .selectDistinct({
        matchingBlobKey: sql<string>`${blobInfoReferences.blobKey}`.as(
          "matching_blob_key",
        ),
      })
      .from(blobInfoReferences)
      .where(
        input.query === folded
          ? foldedMatch
          : sql`${foldedMatch} OR INSTR(${search}, LOWER(${input.query}))`,
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

async function readBlobPage(input: Parameters<typeof listBlobInfoRows>[0]) {
  const rows = await listBlobInfoRows(input);
  const references = await listBlobInfoReferencesForKeys({
    db: input.db,
    keys: rows.map((row) => row.key),
  });
  return attachBlobInfoReferences({ rows, references });
}

function localIdsMissingFilenames(rows: readonly BlobInfo[]): string[] {
  const missing = new Set<string>();
  for (const row of rows) {
    for (const ref of row.references) {
      if (ref.attachmentKind === "local" && ref.name === null)
        missing.add(ref.localId);
    }
  }
  return [...missing];
}

export async function listBlobInfo(
  input: BlobInfoInput & { readonly execSql?: ExecSql | null | undefined },
): Promise<BlobInfoList> {
  if (!input.execSql) {
    return { rows: [], totalCount: 0 };
  }

  const query = input.query?.trim() ?? "";
  const limit = normalizeBlobInfoLimit(input.limit);
  const offset = normalizeBlobInfoWindowValue(input.offset);
  const sort = normalizeBlobInfoSort(input.sort);
  await sqlDocumentsPersistence.ensureSchema(input.execSql);
  await ensureContainerTables(input.execSql);
  if (query) await backfillDocumentAttachmentNames(input.execSql);
  const { db } = getClientSQLitePersistenceRuntime(input.execSql);

  const totalCount = await countBlobInfoRows({
    db,
    query,
  });
  if (limit === 0 || offset >= totalCount) {
    return { rows: [], totalCount };
  }

  const page = { db, limit, offset, query, sort };
  const rows = await readBlobPage(page);
  if (
    !query &&
    (await backfillDocumentAttachmentNames(
      input.execSql,
      localIdsMissingFilenames(rows),
    ))
  ) {
    return { rows: await readBlobPage(page), totalCount };
  }
  return { rows, totalCount };
}
