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
const MAX_BLOB_INFO_LIMIT = 1000;
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

function blobInfoReferenceSearchText(
  reference: BlobInfoDocumentReference,
): string {
  return [
    reference.blobId,
    reference.storageKey,
    reference.mimeType,
    reference.name,
    reference.localId,
    reference.documentId,
    reference.documentTitle,
    reference.containerId,
    reference.slotId,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\u0000")
    .toLocaleLowerCase();
}

function getReferenceChangedAt(
  reference: Pick<BlobInfoDocumentReference, "createdAt" | "updatedAt">,
): string | null {
  return reference.updatedAt ?? reference.createdAt;
}

function getBlobInfoReferenceOrderBy(sort: BlobInfoSort): string {
  const direction = sort.direction === "desc" ? "DESC" : "ASC";
  const tieBreakers =
    "changed_at_sort DESC, blob_key_sort ASC, attachment_kind ASC, local_id ASC, slot_id ASC";

  if (sort.key === "mimeType") {
    return `mime_type ${direction}, ${tieBreakers}`;
  }

  return `changed_at_sort ${direction}, blob_key_sort ASC, attachment_kind ASC, local_id ASC, slot_id ASC`;
}

function compareBlobInfoReference(
  left: BlobInfoDocumentReference,
  right: BlobInfoDocumentReference,
): number {
  return (
    (getReferenceChangedAt(right) ?? "").localeCompare(
      getReferenceChangedAt(left) ?? "",
    ) ||
    left.localId.localeCompare(right.localId) ||
    left.slotId.localeCompare(right.slotId)
  );
}

function chooseBlobInfoMimeType(
  left: string | null,
  right: string | null,
): string | null {
  if (left === null) {
    return right;
  }

  if (right === null) {
    return left;
  }

  return left.localeCompare(right) <= 0 ? left : right;
}

function mergeReferenceIntoBlobInfo(
  current: BlobInfo | undefined,
  reference: BlobInfoDocumentReference,
): BlobInfo {
  if (!current) {
    return {
      blobId: reference.blobId,
      byteLength: reference.byteLength,
      createdAt: reference.createdAt,
      documentCount: 1,
      key: getBlobInfoKey(reference),
      mimeType: reference.mimeType,
      name: reference.name,
      referenceCount: 1,
      references: [reference],
      storageKey: reference.storageKey,
      updatedAt: reference.updatedAt,
    };
  }

  const references = [...current.references, reference].sort(
    compareBlobInfoReference,
  );
  const documentIds = new Set(references.map((item) => item.localId));
  const updatedAt = [current.updatedAt, reference.updatedAt]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const createdAt = [current.createdAt, reference.createdAt]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(0);

  return {
    blobId: current.blobId ?? reference.blobId,
    byteLength: Math.max(current.byteLength, reference.byteLength),
    createdAt: createdAt ?? null,
    documentCount: documentIds.size,
    key: current.key,
    mimeType: chooseBlobInfoMimeType(current.mimeType, reference.mimeType),
    name: current.name ?? reference.name,
    referenceCount: references.length,
    references,
    storageKey: current.storageKey,
    updatedAt: updatedAt ?? null,
  };
}

function groupBlobInfoReferences(
  references: ReadonlyArray<BlobInfoDocumentReference>,
): BlobInfo[] {
  const blobsByKey = new Map<string, BlobInfo>();

  for (const reference of references) {
    const key = getBlobInfoKey(reference);
    blobsByKey.set(
      key,
      mergeReferenceIntoBlobInfo(blobsByKey.get(key), reference),
    );
  }

  return Array.from(blobsByKey.values());
}

function filterBlobInfoRows(
  rows: ReadonlyArray<BlobInfo>,
  query: string,
): BlobInfo[] {
  if (!query) {
    return [...rows];
  }

  return rows.filter((blob) =>
    blob.references.some((reference) =>
      blobInfoReferenceSearchText(reference).includes(query),
    ),
  );
}

function compareNullableText(
  left: string | null,
  right: string | null,
  direction: BlobInfoSortDirection,
): number {
  if (left === right) {
    return 0;
  }

  if (!left) {
    return 1;
  }

  if (!right) {
    return -1;
  }

  const comparison = left.localeCompare(right);
  return direction === "asc" ? comparison : -comparison;
}

function compareBlobInfoBySort(
  left: BlobInfo,
  right: BlobInfo,
  sort: BlobInfoSort,
): number {
  const comparison =
    sort.key === "mimeType"
      ? compareNullableText(left.mimeType, right.mimeType, sort.direction)
      : compareNullableText(
          getReferenceChangedAt(left),
          getReferenceChangedAt(right),
          sort.direction,
        );

  return comparison || left.key.localeCompare(right.key);
}

function sortBlobInfoRows(
  rows: ReadonlyArray<BlobInfo>,
  sort: BlobInfoSort,
): BlobInfo[] {
  return [...rows].sort((left, right) =>
    compareBlobInfoBySort(left, right, sort),
  );
}

async function loadBlobInfoReferences(
  execSql: ExecSql,
  sort: BlobInfoSort,
): Promise<BlobInfoDocumentReference[]> {
  await sqlDocumentsPersistence.ensureSchema(execSql);

  const rows = await execSql(`
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
      pending.storage_key AS blob_key_sort,
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
      COALESCE(local.blob_id, local.storage_key) AS blob_key_sort,
      document.document_id AS document_id,
      document.container_id AS container_id,
      document.document_kind AS document_kind,
      document.title AS document_title
    FROM document_attachment_blob_projection local
    LEFT JOIN document_projection document
      ON document.local_id = local.local_id
    ORDER BY ${getBlobInfoReferenceOrderBy(sort)}
  `);

  return rows.map(mapBlobInfoReferenceRow);
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
  const allReferences = await loadBlobInfoReferences(input.execSql, sort);
  const rows = sortBlobInfoRows(
    filterBlobInfoRows(groupBlobInfoReferences(allReferences), query),
    sort,
  );

  return {
    rows: limit === 0 ? [] : rows.slice(offset, offset + limit),
    totalCount: rows.length,
  };
}
