import {
  createDocument,
  exportFullHistorySnapshot,
  importSnapshot,
  importUpdates,
  LoroImportUnresolvedDependenciesError,
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
const MAX_EXACT_ISOLATION_RETRY_BYTES = 8 * 1024 * 1024;

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

function responseUpdatesById(
  updates: readonly SyncResponseUpdate[] | undefined,
): ReadonlyMap<string, SyncResponseUpdate> {
  return new Map((updates ?? []).map((update) => [update.id, update]));
}

function firstDuplicateUpdateId(
  updates: readonly { readonly id: string }[],
): string | null {
  const seen = new Set<string>();
  for (const update of updates) {
    if (seen.has(update.id)) return update.id;
    seen.add(update.id);
  }
  return null;
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

async function validateDecryptedUpdateBatch(input: {
  currentSnapshot: Uint8Array;
  updates: readonly DecryptedDocumentSyncUpdate[];
}): Promise<void> {
  const document = await createValidationDocument(input.currentSnapshot);
  try {
    const { checkpoints, ordinaryUpdates } = splitDocumentSyncUpdates(
      input.updates,
    );
    for (const checkpoint of checkpoints) {
      importSnapshot(document, checkpoint.updateData);
    }
    if (ordinaryUpdates.length > 0) {
      importUpdates(
        document,
        ordinaryUpdates.map((update) => update.updateData),
      );
    }
  } finally {
    document.free();
  }
}

function exactIsolationRetryExceedsBudget(input: {
  candidates: readonly DecryptedDocumentSyncUpdate[];
  currentSnapshot: Uint8Array;
}): boolean {
  if (input.candidates.length > MAX_EXACT_ISOLATION_CANDIDATES) return true;

  let retryBytes = 0;
  for (const candidateIndex of input.candidates.keys()) {
    if (
      input.currentSnapshot.byteLength >
      MAX_EXACT_ISOLATION_RETRY_BYTES - retryBytes
    ) {
      return true;
    }
    retryBytes += input.currentSnapshot.byteLength;
    for (const [updateIndex, update] of input.candidates.entries()) {
      if (updateIndex === candidateIndex) continue;
      if (
        update.updateData.byteLength >
        MAX_EXACT_ISOLATION_RETRY_BYTES - retryBytes
      ) {
        return true;
      }
      retryBytes += update.updateData.byteLength;
    }
  }
  return false;
}

/** @internal Exported only to exercise the bounded exact-attribution policy. */
export async function findUniqueRepairingCandidate<T>(
  candidates: readonly T[],
  repairsBatch: (candidate: T, candidateIndex: number) => Promise<boolean>,
): Promise<T | null> {
  let repairingCandidate: T | null = null;
  let repairingCandidateCount = 0;
  for (const [candidateIndex, candidate] of candidates.entries()) {
    if (await repairsBatch(candidate, candidateIndex)) {
      repairingCandidate = candidate;
      repairingCandidateCount += 1;
    }
  }
  return repairingCandidateCount === 1 ? repairingCandidate : null;
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

  const duplicateUpdateId =
    firstDuplicateUpdateId(input.decryptedUpdates) ??
    firstDuplicateUpdateId(input.responseUpdates ?? []);
  if (duplicateUpdateId !== null) {
    throw isolateDocumentSyncBatchError({
      cause: new Error(
        `Document sync response update id is duplicated: ${duplicateUpdateId}`,
      ),
      stage: "encrypted_record",
      updateIds: (input.responseUpdates ?? input.decryptedUpdates).map(
        (update) => update.id,
      ),
    });
  }

  const currentSnapshot = exportFullHistorySnapshot(input.currentDocument);
  const responseById = responseUpdatesById(input.responseUpdates);
  let batchError: unknown;
  try {
    await validateDecryptedUpdateBatch({
      currentSnapshot,
      updates: input.decryptedUpdates,
    });
    return;
  } catch (error) {
    batchError = error;
  }

  // A delta can be valid but depend on a parent omitted from this response
  // page. Removing that delta would make an empty retry succeed and falsely
  // identify its authenticated writer as poison, so dependency gaps remain
  // anonymous at batch scope.
  if (batchError instanceof LoroImportUnresolvedDependenciesError) {
    throw isolateDocumentSyncBatchError({
      cause: batchError,
      stage: "loro_import",
      updateIds: input.decryptedUpdates.map((update) => update.id),
    });
  }

  if (
    exactIsolationRetryExceedsBudget({
      candidates: input.decryptedUpdates,
      currentSnapshot,
    })
  ) {
    throw isolateDocumentSyncBatchError({
      cause: batchError,
      stage: "loro_import",
      updateIds: input.decryptedUpdates.map((update) => update.id),
    });
  }

  // Rebuild from the same immutable snapshot for every candidate: a failed
  // import may partially mutate its scratch document. Checkpoints participate
  // alongside ordinary updates so an incompatibility between the two kinds
  // cannot falsely blame the ordinary writer. Keeping every other update in
  // one batch also preserves out-of-order sibling dependencies.
  const isolatedUpdate = await findUniqueRepairingCandidate(
    input.decryptedUpdates,
    async (_update, candidateIndex) => {
      const withoutCandidate = input.decryptedUpdates.filter(
        (_, updateIndex) => updateIndex !== candidateIndex,
      );
      try {
        await validateDecryptedUpdateBatch({
          currentSnapshot,
          updates: withoutCandidate,
        });
        return true;
      } catch {
        // This candidate is either valid and required by a sibling, or another
        // poison update remains. Continue without attributing it.
        return false;
      }
    },
  );
  if (isolatedUpdate) {
    throw isolateDocumentSyncUpdateError({
      cause: batchError,
      responseUpdate: responseById.get(isolatedUpdate.id),
      stage: "loro_import",
      updateId: isolatedUpdate.id,
    });
  }

  // Multiple bad updates or a batch-level incompatibility may have zero or
  // multiple removals that repair the page. Fail closed without falsely naming
  // a valid writer; no live or durable state has changed.
  throw isolateDocumentSyncBatchError({
    cause: batchError,
    stage: "loro_import",
    updateIds: input.decryptedUpdates.map((update) => update.id),
  });
}
