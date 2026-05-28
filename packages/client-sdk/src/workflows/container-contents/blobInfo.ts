import type { StoredDocumentKind } from "../../data/documents/documentKinds";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql, SqlRow } from "../../data/sqlite/sqlSchema";

export type BlobInfoAttachmentKind = "local" | "pending";

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
}

const DEFAULT_BLOB_INFO_LIMIT = 200;
const MAX_BLOB_INFO_LIMIT = 1000;

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
    mimeType: current.mimeType ?? reference.mimeType,
    name: current.name ?? reference.name,
    referenceCount: references.length,
    references,
    storageKey: current.storageKey,
    updatedAt: updatedAt ?? null,
  };
}

function compareBlobInfo(left: BlobInfo, right: BlobInfo): number {
  return (
    (getReferenceChangedAt(right) ?? "").localeCompare(
      getReferenceChangedAt(left) ?? "",
    ) || left.key.localeCompare(right.key)
  );
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

  return Array.from(blobsByKey.values()).sort(compareBlobInfo);
}

function filterBlobInfoReferences(
  references: ReadonlyArray<BlobInfoDocumentReference>,
  query: string,
): BlobInfoDocumentReference[] {
  if (!query) {
    return [...references];
  }

  return references.filter((reference) =>
    blobInfoReferenceSearchText(reference).includes(query),
  );
}

async function loadBlobInfoReferences(
  execSql: ExecSql,
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
      document.document_id AS document_id,
      document.container_id AS container_id,
      document.document_kind AS document_kind,
      document.title AS document_title
    FROM document_attachment_blob_projection local
    LEFT JOIN document_projection document
      ON document.local_id = local.local_id
  `);

  return rows.map(mapBlobInfoReferenceRow);
}

export async function listBlobInfo(input: {
  readonly execSql?: ExecSql | null | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly query?: string | undefined;
}): Promise<BlobInfoList> {
  if (!input.execSql) {
    return { rows: [], totalCount: 0 };
  }

  const query = normalizeBlobInfoQuery(input.query);
  const limit = normalizeBlobInfoLimit(input.limit);
  const offset = normalizeBlobInfoWindowValue(input.offset);
  const references = filterBlobInfoReferences(
    await loadBlobInfoReferences(input.execSql),
    query,
  );
  const rows = groupBlobInfoReferences(references);

  return {
    rows: limit === 0 ? [] : rows.slice(offset, offset + limit),
    totalCount: rows.length,
  };
}
