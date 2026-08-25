import {
  createDocument,
  exportFullHistorySnapshot,
  importSnapshot,
  importUpdates,
} from "@symcrypt/loro";
import type { DocumentSyncResponse } from "@symcrypt/validators/response";
import type {
  DecryptedDocumentSyncUpdate,
  SyncRemoteDocumentResult,
} from "./types";

type DocumentSyncUpdateIsolationStage =
  | "content_key"
  | "decrypt"
  | "encrypted_record"
  | "loro_import"
  | "loro_metadata"
  | "plaintext_integrity"
  | "write_header";

type SyncResponseUpdate = DocumentSyncResponse["updates"][number];
type SyncDocument = Awaited<ReturnType<typeof createDocument>>;

const MAX_EXACT_ISOLATION_CANDIDATES = 8;
const MAX_EXACT_ISOLATION_BYTES = 8 * 1024 * 1024;

export type IncomingDocumentSyncUpdateValidator = (
  result: Pick<SyncRemoteDocumentResult, "decryptedUpdates" | "response">,
) => void | Promise<void>;

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
  readonly checkpointKind: "rotate_baseline" | null;
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
    );
    this.name = "DocumentSyncUpdateIsolationError";
    this.attribution = input.updateId === null ? "batch" : "update";
    this.authorFingerprint = input.responseUpdate?.authorFingerprint ?? null;
    this.batchUpdateIds = [...batchUpdateIds];
    this.checkpointKind =
      input.responseUpdate?.checkpointKind === "rotate_baseline"
        ? "rotate_baseline"
        : null;
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

function isolateDocumentSyncBatchError(input: {
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

function responseUpdatesById(
  updates: readonly SyncResponseUpdate[] | undefined,
): ReadonlyMap<string, SyncResponseUpdate> {
  return new Map((updates ?? []).map((update) => [update.id, update]));
}

function importCheckpoints(
  document: SyncDocument,
  updates: readonly DecryptedDocumentSyncUpdate[],
  responseById: ReadonlyMap<string, SyncResponseUpdate>,
): void {
  for (const update of updates) {
    try {
      importSnapshot(document, update.updateData);
    } catch (error) {
      throw isolateDocumentSyncUpdateError({
        cause: error,
        responseUpdate: responseById.get(update.id),
        stage: "loro_import",
        updateId: update.id,
      });
    }
  }
}

async function createValidationDocument(snapshot: Uint8Array) {
  const document = await createDocument(crypto.randomUUID());
  try {
    importSnapshot(document, snapshot);
    return document;
  } catch (error) {
    document.free();
    throw error;
  }
}

function splitDocumentSyncUpdates(
  updates: readonly DecryptedDocumentSyncUpdate[],
): {
  checkpoints: DecryptedDocumentSyncUpdate[];
  ordinaryUpdates: DecryptedDocumentSyncUpdate[];
} {
  const checkpoints: DecryptedDocumentSyncUpdate[] = [];
  const ordinaryUpdates: DecryptedDocumentSyncUpdate[] = [];
  for (const update of updates) {
    if (
      update.checkpointKind === "rotate_baseline" &&
      update.checkpointPayloadKind === "full_history_snapshot"
    ) {
      checkpoints.push(update);
    } else {
      ordinaryUpdates.push(update);
    }
  }
  return { checkpoints, ordinaryUpdates };
}

/** Applies checkpoints with the snapshot API before batching ordinary deltas. */
export function importDecryptedDocumentSyncUpdates(
  document: SyncDocument,
  updates: readonly DecryptedDocumentSyncUpdate[],
): void {
  const { checkpoints, ordinaryUpdates } = splitDocumentSyncUpdates(updates);
  for (const checkpoint of checkpoints) {
    importSnapshot(document, checkpoint.updateData);
  }
  if (ordinaryUpdates.length > 0) {
    importUpdates(
      document,
      ordinaryUpdates.map((update) => update.updateData),
    );
  }
}

async function validateOrdinaryUpdateBatch(input: {
  checkpoints: readonly DecryptedDocumentSyncUpdate[];
  currentSnapshot: Uint8Array;
  ordinaryUpdates: readonly DecryptedDocumentSyncUpdate[];
  responseById: ReadonlyMap<string, SyncResponseUpdate>;
}): Promise<void> {
  const document = await createValidationDocument(input.currentSnapshot);
  try {
    importCheckpoints(document, input.checkpoints, input.responseById);
    if (input.ordinaryUpdates.length > 0) {
      importUpdates(
        document,
        input.ordinaryUpdates.map((update) => update.updateData),
      );
    }
  } finally {
    document.free();
  }
}

/**
 * Proves that a decrypted response can be imported before the live document or
 * any durable sync frontier is mutated. On failure, retries the page without
 * each candidate so valid sibling dependencies remain in the same batch while
 * the update whose removal repairs the batch is attributed exactly.
 */
export async function validateDocumentSyncUpdateImports(input: {
  currentDocument: Awaited<ReturnType<typeof createDocument>>;
  decryptedUpdates: readonly DecryptedDocumentSyncUpdate[];
  responseUpdates?: readonly SyncResponseUpdate[] | undefined;
}): Promise<void> {
  if (input.decryptedUpdates.length === 0) return;

  const currentSnapshot = exportFullHistorySnapshot(input.currentDocument);
  const responseById = responseUpdatesById(input.responseUpdates);
  const { checkpoints, ordinaryUpdates } = splitDocumentSyncUpdates(
    input.decryptedUpdates,
  );
  const validationDocument = await createValidationDocument(currentSnapshot);
  let batchError: unknown;
  try {
    importCheckpoints(validationDocument, checkpoints, responseById);
    if (ordinaryUpdates.length === 0) return;
    importUpdates(
      validationDocument,
      ordinaryUpdates.map((update) => update.updateData),
    );
    return;
  } catch (error) {
    if (isDocumentSyncUpdateIsolationError(error)) {
      throw error;
    }
    batchError = error;
  } finally {
    validationDocument.free();
  }

  const exactIsolationBytes = ordinaryUpdates.reduce(
    (total, update) => total + update.updateData.byteLength,
    0,
  );
  if (
    ordinaryUpdates.length > MAX_EXACT_ISOLATION_CANDIDATES ||
    exactIsolationBytes > MAX_EXACT_ISOLATION_BYTES
  ) {
    throw isolateDocumentSyncBatchError({
      cause: batchError,
      stage: "loro_import",
      updateIds: ordinaryUpdates.map((update) => update.id),
    });
  }

  // Rebuild from the same immutable snapshot for every candidate: a failed
  // import may partially mutate its scratch document. Keeping every other
  // ordinary update in one batch preserves out-of-order sibling dependencies;
  // removing a required valid parent therefore cannot falsely blame it.
  for (const [candidateIndex, update] of ordinaryUpdates.entries()) {
    const withoutCandidate = ordinaryUpdates.filter(
      (_, updateIndex) => updateIndex !== candidateIndex,
    );
    let importsWithoutCandidate = false;
    try {
      await validateOrdinaryUpdateBatch({
        checkpoints,
        currentSnapshot,
        ordinaryUpdates: withoutCandidate,
        responseById,
      });
      importsWithoutCandidate = true;
    } catch {
      // This candidate is either valid and required by a sibling, or another
      // poison update remains. Continue without attributing it.
    }
    if (importsWithoutCandidate) {
      throw isolateDocumentSyncUpdateError({
        cause: batchError,
        responseUpdate: responseById.get(update.id),
        stage: "loro_import",
        updateId: update.id,
      });
    }
  }

  // Multiple bad updates or a batch-level incompatibility may have no single
  // removal that repairs the page. Fail closed without falsely naming a valid
  // writer; no live or durable state has changed.
  throw isolateDocumentSyncBatchError({
    cause: batchError,
    stage: "loro_import",
    updateIds: ordinaryUpdates.map((update) => update.id),
  });
}
