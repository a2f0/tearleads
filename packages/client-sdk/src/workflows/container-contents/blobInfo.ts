import type { StoredDocumentKind } from "../../data/documents/documentKinds";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql, SqlRow } from "../../data/sqlite/sqlSchema";

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

function readNullableString(row: SqlRow, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readRequiredString(row: SqlRow, key: string): string {
  const value = readNullableString(row, key);
  if (!value) {
    throw new Error(`Blob info row is missing ${key}.`);
  }

  return value;
}

function readRequiredNumber(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Blob info row is missing ${key}.`);
  }

  return value;
}

function readAttachmentKind(row: SqlRow): BlobInfoAttachmentKind {
  const value = readRequiredString(row, "attachment_kind");
  if (value === "local" || value === "pending") {
    return value;
  }

  throw new Error(`Blob info row has invalid attachment kind ${value}.`);
}

function mapBlobInfoReferenceRow(row: SqlRow): BlobInfoDocumentReference {
  return {
    attachmentKind: readAttachmentKind(row),
    blobId: readNullableString(row, "blob_id"),
    byteLength: readRequiredNumber(row, "byte_length"),
    containerId: readNullableString(row, "container_id"),
    createdAt: readNullableString(row, "created_at"),
    documentId: readNullableString(row, "document_id"),
    documentKind: readNullableString(
      row,
      "document_kind",
    ) as StoredDocumentKind | null,
    documentTitle: readNullableString(row, "document_title"),
    localId: readRequiredString(row, "local_id"),
    mimeType: readNullableString(row, "mime_type"),
    name: readNullableString(row, "name"),
    slotId: readRequiredString(row, "slot_id"),
    storageKey: readRequiredString(row, "storage_key"),
    updatedAt: readNullableString(row, "updated_at"),
  };
}

function mapBlobInfoRow(row: SqlRow): Omit<BlobInfo, "references"> {
  return {
    blobId: readNullableString(row, "blob_id"),
    byteLength: readRequiredNumber(row, "byte_length"),
    createdAt: readNullableString(row, "created_at"),
    documentCount: readRequiredNumber(row, "document_count"),
    key: readRequiredString(row, "blob_key"),
    mimeType: readNullableString(row, "mime_type"),
    name: readNullableString(row, "name"),
    referenceCount: readRequiredNumber(row, "reference_count"),
    storageKey: readRequiredString(row, "storage_key"),
    updatedAt: readNullableString(row, "updated_at"),
  };
}

function renderBlobInfoGroupedOrderBy(sort: BlobInfoSort): string {
  const direction = sort.direction === "desc" ? "DESC" : "ASC";

  if (sort.key === "mimeType") {
    return [
      "mime_type IS NULL ASC",
      `mime_type COLLATE NOCASE ${direction}`,
      "changed_at_sort DESC",
      "blob_key ASC",
    ].join(", ");
  }

  return [
    "changed_at_sort IS NULL ASC",
    `changed_at_sort ${direction}`,
    "blob_key ASC",
  ].join(", ");
}

function blobInfoReferencesCte(): string {
  return `
    WITH blob_info_references AS (
      SELECT
        'pending' AS attachment_kind,
        pending.local_id AS local_id,
        pending.slot_id AS slot_id,
        NULL AS blob_id,
        pending.storage_key AS storage_key,
        pending.mime_type AS mime_type,
        pending.byte_length AS byte_length,
        pending.name AS name,
        pending.created_at AS created_at,
        NULL AS updated_at,
        pending.created_at AS changed_at_sort,
        'storage:' || pending.storage_key AS blob_key,
        LOWER(
          COALESCE(pending.storage_key, '')
          || CHAR(0) || COALESCE(pending.mime_type, '')
          || CHAR(0) || COALESCE(pending.name, '')
          || CHAR(0) || COALESCE(pending.local_id, '')
          || CHAR(0) || COALESCE(document.document_id, '')
          || CHAR(0) || COALESCE(document.title, '')
          || CHAR(0) || COALESCE(document.container_id, '')
          || CHAR(0) || COALESCE(pending.slot_id, '')
        ) AS search_text,
        document.document_id AS document_id,
        document.container_id AS container_id,
        document.document_kind AS document_kind,
        document.title AS document_title
      FROM document_pending_attachments pending
      LEFT JOIN document_projection document
        ON document.local_id = pending.local_id
      UNION ALL
      SELECT
        'local' AS attachment_kind,
        local.local_id AS local_id,
        local.slot_id AS slot_id,
        local.blob_id AS blob_id,
        local.storage_key AS storage_key,
        local.mime_type AS mime_type,
        local.byte_length AS byte_length,
        NULL AS name,
        NULL AS created_at,
        local.updated_at AS updated_at,
        local.updated_at AS changed_at_sort,
        CASE
          WHEN local.blob_id IS NOT NULL AND local.blob_id <> ''
            THEN 'blob:' || local.blob_id
          ELSE 'storage:' || local.storage_key
        END AS blob_key,
        LOWER(
          COALESCE(local.blob_id, '')
          || CHAR(0) || COALESCE(local.storage_key, '')
          || CHAR(0) || COALESCE(local.mime_type, '')
          || CHAR(0) || COALESCE(local.local_id, '')
          || CHAR(0) || COALESCE(document.document_id, '')
          || CHAR(0) || COALESCE(document.title, '')
          || CHAR(0) || COALESCE(document.container_id, '')
          || CHAR(0) || COALESCE(local.slot_id, '')
        ) AS search_text,
        document.document_id AS document_id,
        document.container_id AS container_id,
        document.document_kind AS document_kind,
        document.title AS document_title
      FROM document_attachment_blob_projection local
      LEFT JOIN document_projection document
        ON document.local_id = local.local_id
    )`;
}

function groupedBlobInfoCte(): string {
  return `
    ${blobInfoReferencesCte()},
    matching_blob_keys AS (
      SELECT DISTINCT blob_key
      FROM blob_info_references
      WHERE ? = '' OR INSTR(search_text, ?) > 0
    ),
    grouped_blob_info AS (
      SELECT
        refs.blob_key AS blob_key,
        MIN(NULLIF(refs.blob_id, '')) AS blob_id,
        MAX(refs.byte_length) AS byte_length,
        MIN(NULLIF(refs.created_at, '')) AS created_at,
        MAX(NULLIF(refs.updated_at, '')) AS updated_at,
        COALESCE(
          MAX(NULLIF(refs.updated_at, '')),
          MIN(NULLIF(refs.created_at, ''))
        ) AS changed_at_sort,
        COUNT(DISTINCT refs.local_id) AS document_count,
        MIN(NULLIF(refs.mime_type, '')) AS mime_type,
        MIN(NULLIF(refs.name, '')) AS name,
        COUNT(*) AS reference_count,
        MIN(refs.storage_key) AS storage_key
      FROM blob_info_references refs
      INNER JOIN matching_blob_keys matching
        ON matching.blob_key = refs.blob_key
      GROUP BY refs.blob_key
    )`;
}

async function countBlobInfoRows(input: {
  readonly execSql: ExecSql;
  readonly query: string;
}): Promise<number> {
  const rows = await input.execSql(
    `
      ${groupedBlobInfoCte()}
      SELECT COUNT(*) AS total_count
      FROM grouped_blob_info
    `,
    [input.query, input.query],
  );

  return readRequiredNumber(rows[0] ?? {}, "total_count");
}

async function listBlobInfoRows(input: {
  readonly execSql: ExecSql;
  readonly limit: number;
  readonly offset: number;
  readonly query: string;
  readonly sort: BlobInfoSort;
}): Promise<Array<Omit<BlobInfo, "references">>> {
  const rows = await input.execSql(
    `
      ${groupedBlobInfoCte()}
      SELECT
        blob_key,
        blob_id,
        byte_length,
        created_at,
        updated_at,
        document_count,
        mime_type,
        name,
        reference_count,
        storage_key
      FROM grouped_blob_info
      ORDER BY ${renderBlobInfoGroupedOrderBy(input.sort)}
      LIMIT ? OFFSET ?
    `,
    [input.query, input.query, input.limit, input.offset],
  );

  return rows.map(mapBlobInfoRow);
}

function blobInfoReferenceKeyPlaceholders(keys: ReadonlyArray<string>): string {
  return keys.map(() => "?").join(", ");
}

async function listBlobInfoReferencesForKeys(input: {
  readonly execSql: ExecSql;
  readonly keys: ReadonlyArray<string>;
}): Promise<BlobInfoDocumentReference[]> {
  if (input.keys.length === 0) {
    return [];
  }

  const rows = await input.execSql(
    `
      ${blobInfoReferencesCte()}
    SELECT
        attachment_kind,
        local_id,
        slot_id,
        blob_id,
        storage_key,
        mime_type,
        byte_length,
        name,
        created_at,
        updated_at,
        document_id,
        container_id,
        document_kind,
        document_title
      FROM blob_info_references
      WHERE blob_key IN (${blobInfoReferenceKeyPlaceholders(input.keys)})
      ORDER BY blob_key ASC, changed_at_sort DESC, local_id ASC, slot_id ASC
    `,
    [...input.keys],
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

  const totalCount = await countBlobInfoRows({
    execSql: input.execSql,
    query,
  });
  if (limit === 0 || offset >= totalCount) {
    return { rows: [], totalCount };
  }

  const groupedRows = await listBlobInfoRows({
    execSql: input.execSql,
    limit,
    offset,
    query,
    sort,
  });
  const references = await listBlobInfoReferencesForKeys({
    execSql: input.execSql,
    keys: groupedRows.map((row) => row.key),
  });

  return {
    rows: attachBlobInfoReferences({ references, rows: groupedRows }),
    totalCount,
  };
}
