const MULTIPART_BLOB_STAGE_RECORD_FORMAT = "tearleads.blob.multipart-stage.v1";
const EXTERNAL_BLOB_BYTES_REF_FORMAT = "tearleads.blob.external-bytes-ref.v1";

type MultipartBlobStageState = "complete" | "pending";

interface MultipartBlobStageRecord {
  readonly format: typeof MULTIPART_BLOB_STAGE_RECORD_FORMAT;
  readonly state: MultipartBlobStageState;
  readonly storageKey: string;
  readonly uploadId: string;
}

interface ExternalBlobBytesRef {
  readonly format: typeof EXTERNAL_BLOB_BYTES_REF_FORMAT;
  readonly storageKey: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getRecordValue(
  record: Record<string, unknown> | null,
  key: string,
): unknown {
  return record?.[key];
}

export function encodeMultipartBlobStageRecord(input: {
  readonly state: MultipartBlobStageState;
  readonly storageKey: string;
  readonly uploadId: string;
}): string {
  return JSON.stringify({
    format: MULTIPART_BLOB_STAGE_RECORD_FORMAT,
    state: input.state,
    storageKey: input.storageKey,
    uploadId: input.uploadId,
  } satisfies MultipartBlobStageRecord);
}

export function readMultipartBlobStageRecord(
  value: string,
): MultipartBlobStageRecord | null {
  const record = parseJsonRecord(value);
  const format = getRecordValue(record, "format");
  const state = getRecordValue(record, "state");
  const storageKey = getRecordValue(record, "storageKey");
  const uploadId = getRecordValue(record, "uploadId");
  if (
    format !== MULTIPART_BLOB_STAGE_RECORD_FORMAT ||
    (state !== "pending" && state !== "complete") ||
    typeof storageKey !== "string" ||
    storageKey.length === 0 ||
    typeof uploadId !== "string" ||
    uploadId.length === 0
  ) {
    return null;
  }

  return {
    format: MULTIPART_BLOB_STAGE_RECORD_FORMAT,
    state,
    storageKey,
    uploadId,
  };
}

export function encodeExternalBlobBytesRef(input: {
  readonly storageKey: string;
}): string {
  return JSON.stringify({
    format: EXTERNAL_BLOB_BYTES_REF_FORMAT,
    storageKey: input.storageKey,
  } satisfies ExternalBlobBytesRef);
}

export function readExternalBlobBytesRef(
  value: string,
): ExternalBlobBytesRef | null {
  const record = parseJsonRecord(value);
  const format = getRecordValue(record, "format");
  const storageKey = getRecordValue(record, "storageKey");
  if (
    format !== EXTERNAL_BLOB_BYTES_REF_FORMAT ||
    typeof storageKey !== "string" ||
    storageKey.length === 0
  ) {
    return null;
  }

  return {
    format: EXTERNAL_BLOB_BYTES_REF_FORMAT,
    storageKey,
  };
}
