import type { DocumentSyncResponse } from "@tearleads/validators/response";

type DocumentSyncUpdateIsolationStage =
  | "content_key"
  | "decrypt"
  | "decrypt_runtime"
  | "encrypted_record"
  | "loro_import"
  | "loro_metadata"
  | "loro_runtime"
  | "plaintext_integrity"
  | "write_header";

type SyncResponseUpdate = DocumentSyncResponse["updates"][number];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function optionalHeaderField(
  update: SyncResponseUpdate | undefined,
  field: string,
): unknown {
  const header = update?.writeHeader;
  return header && typeof header === "object"
    ? Reflect.get(header, field)
    : undefined;
}

function optionalHeaderString(
  update: SyncResponseUpdate | undefined,
  field: string,
): string | null {
  const value = optionalHeaderField(update, field);
  return typeof value === "string" ? value : null;
}

/** The content-key epoch a served update's write header names, if any. */
function optionalHeaderEpoch(
  update: SyncResponseUpdate | undefined,
): number | null {
  const value = optionalHeaderField(update, "contentKeyEpoch");
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

export class DocumentSyncUpdateIsolationError extends Error {
  readonly attribution: "batch" | "update";
  readonly authorFingerprint: string | null;
  readonly batchUpdateIds: readonly string[];
  /** The rotation baseline the update is a segment of, if it is one. */
  readonly baselineId: string | null;
  readonly ciphertextHash: string | null;
  readonly contentKeyEpoch: number | null;
  readonly documentId: string | null;
  readonly metadataHash: string | null;
  readonly stage: DocumentSyncUpdateIsolationStage;
  readonly updateId: string | null;
  readonly writerUserId: string | null;

  constructor(input: {
    batchUpdateIds?: readonly string[] | undefined;
    cause: unknown;
    responseUpdate?: SyncResponseUpdate | undefined;
    stage: DocumentSyncUpdateIsolationStage;
    updateId: string | null;
  }) {
    const causeMessage = errorMessage(input.cause);
    const writerUserId = optionalHeaderString(
      input.responseUpdate,
      "writerUserId",
    );
    const author =
      writerUserId ?? input.responseUpdate?.authorFingerprint ?? "unknown";
    const fingerprint = input.responseUpdate?.authorFingerprint ?? "unknown";
    const epoch = optionalHeaderEpoch(input.responseUpdate) ?? "unknown";
    const batchUpdateIds =
      input.updateId === null ? (input.batchUpdateIds ?? []) : [];
    const subject =
      input.updateId === null
        ? `response batch containing ${batchUpdateIds.length} updates; exact update and writer unknown`
        : `update ${input.updateId} from writer ${author} (fingerprint ${fingerprint}, epoch ${epoch})`;
    super(
      `Document sync quarantined ${subject} during ${input.stage}: ${causeMessage}`,
      { cause: input.cause },
    );
    this.name = "DocumentSyncUpdateIsolationError";
    this.attribution = input.updateId === null ? "batch" : "update";
    this.authorFingerprint = input.responseUpdate?.authorFingerprint ?? null;
    this.batchUpdateIds = [...batchUpdateIds];
    this.baselineId = input.responseUpdate?.baselineId ?? null;
    this.ciphertextHash = optionalHeaderString(
      input.responseUpdate,
      "ciphertextHash",
    );
    this.contentKeyEpoch = optionalHeaderEpoch(input.responseUpdate);
    this.documentId = input.responseUpdate?.documentId ?? null;
    this.metadataHash = optionalHeaderString(
      input.responseUpdate,
      "metadataHash",
    );
    this.stage = input.stage;
    this.updateId = input.updateId;
    this.writerUserId = writerUserId;
  }
}

export function isolateDocumentSyncBatchError(input: {
  cause: unknown;
  stage: DocumentSyncUpdateIsolationStage;
  updateIds: readonly string[];
}): DocumentSyncUpdateIsolationError {
  return new DocumentSyncUpdateIsolationError({
    batchUpdateIds: input.updateIds,
    cause: input.cause,
    stage: input.stage,
    updateId: null,
  });
}

export function isolateDocumentSyncUpdateError(input: {
  cause: unknown;
  responseUpdate?: SyncResponseUpdate | undefined;
  stage: DocumentSyncUpdateIsolationStage;
  updateId: string;
}): DocumentSyncUpdateIsolationError {
  return input.cause instanceof DocumentSyncUpdateIsolationError
    ? input.cause
    : new DocumentSyncUpdateIsolationError(input);
}

export function isDocumentSyncUpdateIsolationError(
  error: unknown,
): error is DocumentSyncUpdateIsolationError {
  return error instanceof DocumentSyncUpdateIsolationError;
}
