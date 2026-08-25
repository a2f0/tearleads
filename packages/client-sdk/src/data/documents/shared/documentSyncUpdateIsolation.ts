import {
  createDocument,
  exportFullHistorySnapshot,
  importSnapshot,
  importUpdates,
} from "@symcrypt/loro";
import type { DocumentSyncResponse } from "@symcrypt/validators/response";
import type { DecryptedDocumentSyncUpdate } from "./types";

type DocumentSyncUpdateIsolationStage =
  | "content_key"
  | "decrypt"
  | "encrypted_record"
  | "loro_import"
  | "loro_metadata"
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

function optionalHeaderEpoch(
  update: SyncResponseUpdate | undefined,
): number | null {
  const value = optionalHeaderField(update, "contentKeyEpoch");
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

export class DocumentSyncUpdateIsolationError extends Error {
  readonly authorFingerprint: string | null;
  readonly checkpointKind: "rotate_baseline" | null;
  readonly ciphertextHash: string | null;
  readonly contentKeyEpoch: number | null;
  readonly documentId: string | null;
  readonly metadataHash: string | null;
  readonly stage: DocumentSyncUpdateIsolationStage;
  readonly updateId: string;
  readonly writerUserId: string | null;

  constructor(input: {
    cause: unknown;
    responseUpdate?: SyncResponseUpdate | undefined;
    stage: DocumentSyncUpdateIsolationStage;
    updateId: string;
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
    super(
      `Document sync quarantined update ${input.updateId} from writer ${author} (fingerprint ${fingerprint}, epoch ${epoch}) during ${input.stage}: ${causeMessage}`,
    );
    this.name = "DocumentSyncUpdateIsolationError";
    this.authorFingerprint = input.responseUpdate?.authorFingerprint ?? null;
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
  document: Awaited<ReturnType<typeof createDocument>>,
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
  importSnapshot(document, snapshot);
  return document;
}

/**
 * Proves that a decrypted response can be imported before the live document or
 * any durable sync frontier is mutated. On failure, replays the ordinary page
 * one update at a time to attribute the first update that cannot be applied.
 */
export async function validateDocumentSyncUpdateImports(input: {
  currentDocument: Awaited<ReturnType<typeof createDocument>>;
  decryptedUpdates: readonly DecryptedDocumentSyncUpdate[];
  responseUpdates?: readonly SyncResponseUpdate[] | undefined;
}): Promise<void> {
  if (input.decryptedUpdates.length === 0) return;

  const currentSnapshot = exportFullHistorySnapshot(input.currentDocument);
  const responseById = responseUpdatesById(input.responseUpdates);
  const checkpoints = input.decryptedUpdates.filter(
    (update) =>
      update.checkpointKind === "rotate_baseline" &&
      update.checkpointPayloadKind === "full_history_snapshot",
  );
  const ordinaryUpdates = input.decryptedUpdates.filter(
    (update) =>
      update.checkpointKind !== "rotate_baseline" ||
      update.checkpointPayloadKind !== "full_history_snapshot",
  );
  const validationDocument = await createValidationDocument(currentSnapshot);
  importCheckpoints(validationDocument, checkpoints, responseById);
  if (ordinaryUpdates.length === 0) return;

  let batchError: unknown;
  try {
    importUpdates(
      validationDocument,
      ordinaryUpdates.map((update) => update.updateData),
    );
    return;
  } catch (error) {
    batchError = error;
    // Rebuild from the same immutable snapshot: the failed batch may have
    // partially mutated its scratch document before throwing.
  }

  const isolationDocument = await createValidationDocument(currentSnapshot);
  importCheckpoints(isolationDocument, checkpoints, responseById);
  for (const update of ordinaryUpdates) {
    try {
      importUpdates(isolationDocument, [update.updateData]);
    } catch (error) {
      throw isolateDocumentSyncUpdateError({
        cause: error,
        responseUpdate: responseById.get(update.id),
        stage: "loro_import",
        updateId: update.id,
      });
    }
  }

  // The live import uses the same batch API. If incremental replay succeeds
  // but the batch still fails, reject it rather than allowing a later live
  // import to mutate partially. The final update is the point at which the
  // otherwise-valid prefix became the rejected batch.
  const lastUpdate = ordinaryUpdates.at(-1);
  if (lastUpdate) {
    throw isolateDocumentSyncUpdateError({
      cause: batchError,
      responseUpdate: responseById.get(lastUpdate.id),
      stage: "loro_import",
      updateId: lastUpdate.id,
    });
  }
}
