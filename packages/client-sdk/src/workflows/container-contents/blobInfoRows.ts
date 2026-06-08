import type {
  BlobInfo,
  BlobInfoAttachmentKind,
  BlobInfoDocumentReference,
} from "./blobInfoTypes";

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

export function readRequiredNumber(
  value: number | null | undefined,
  key: string,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Blob info row is missing ${key}.`);
  }

  return value;
}

export function mapBlobInfoReferenceRow(
  row: BlobInfoReferenceRow,
): BlobInfoDocumentReference {
  return {
    attachmentKind: row.attachmentKind,
    blobId: readNullableString(row.blobId),
    byteLength: readRequiredNumber(row.byteLength, "byte_length"),
    containerId: readNullableString(row.containerId),
    createdAt: readNullableString(row.createdAt),
    documentId: readNullableString(row.documentId),
    documentKind: readNullableString(row.documentKind),
    documentTitle: readNullableString(row.documentTitle),
    localId: readRequiredString(row.localId, "local_id"),
    mimeType: readNullableString(row.mimeType),
    name: readNullableString(row.name),
    slotId: readRequiredString(row.slotId, "slot_id"),
    storageKey: readRequiredString(row.storageKey, "storage_key"),
    updatedAt: readNullableString(row.updatedAt),
  };
}

export function mapBlobInfoRow(
  row: GroupedBlobInfoRow,
): Omit<BlobInfo, "references"> {
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

function getBlobInfoKey(
  reference: Pick<BlobInfoDocumentReference, "blobId" | "storageKey">,
): string {
  return reference.blobId
    ? `blob:${reference.blobId}`
    : `storage:${reference.storageKey}`;
}

export function attachBlobInfoReferences(input: {
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
