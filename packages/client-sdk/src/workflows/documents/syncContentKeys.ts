import type {
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@symcrypt/validators/response";
import { importContentKeyMaterial } from "../../data/documents/shared/contentRecordKeys";
import { encryptDocumentPendingUpdate } from "../../data/documents/shared/crypto";
import {
  isolateDocumentSyncBatchError,
  isolateDocumentSyncUpdateError,
} from "../../data/documents/shared/documentSyncUpdateIsolation";
import {
  collectContainerKeksForDocumentSync,
  DocumentContentKeyUnavailableError,
  DocumentHistoryUnavailableError,
  unwrapDocumentContentKeyFromBundle,
} from "../../data/documents/shared/projection";
import {
  readWriteHeader,
  serializeCanonical,
} from "../../data/documents/shared/readers";
import type {
  DocumentSyncPreparedUpdate,
  ProjectionVerificationOptions,
} from "../../data/documents/shared/types";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import { isKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

type SyncResponseUpdate = DocumentSyncResponse["updates"][number];

/** A raw recovery cannot reconstruct history without this retained epoch. */
export class DocumentRawHistoryUnavailableError extends Error {
  readonly code = "document_raw_history_epoch_unavailable";

  constructor(
    readonly contentKeyEpoch: number,
    cause: unknown,
  ) {
    super(
      `Document raw-history recovery cannot decrypt content-key epoch ${contentKeyEpoch}`,
      { cause },
    );
    this.name = "DocumentRawHistoryUnavailableError";
  }
}

export async function prepareDocumentOutgoingUpdates(input: {
  contentKey: Uint8Array;
  contentKeyEpoch: number;
  documentId: string;
  organizationId: string;
  pendingUpdates: readonly PendingUpdateRecord[];
}): Promise<DocumentSyncPreparedUpdate[]> {
  if (input.pendingUpdates.length === 0) {
    return [];
  }
  const contentKeyMaterial = await importContentKeyMaterial(input.contentKey);

  return Promise.all(
    input.pendingUpdates.map(async (update) => {
      const encrypted = await encryptDocumentPendingUpdate({
        contentKeyMaterial,
        contentKeyEpoch: input.contentKeyEpoch,
        documentId: input.documentId,
        organizationId: input.organizationId,
        update,
      });

      return {
        contentRecordId: encrypted.contentRecordId,
        encryptedData: encrypted.encryptedData,
        id: update.id,
        partialStartVersionVector: update.partialStartVersionVector,
        partialEndVersionVector: update.partialEndVersionVector,
        metadataHash: encrypted.metadataHash,
        ciphertextHash: encrypted.ciphertextHash,
        plaintextHash: encrypted.plaintextHash,
        ...(update.sourceVersionVector
          ? {
              checkpointKind: "rotate_baseline" as const,
              checkpointPayloadKind: "full_history_snapshot" as const,
              sourceVersionVector: update.sourceVersionVector,
            }
          : {}),
      };
    }),
  );
}

function syncResponseContentKeyBundlesByEpoch(
  response: DocumentSyncResponse,
): ReadonlyMap<number, DocumentSyncResponse["contentKeyBundle"]> {
  const byEpoch = new Map<number, DocumentSyncResponse["contentKeyBundle"]>();

  for (const bundle of [
    response.contentKeyBundle,
    ...response.contentKeyBundles,
  ]) {
    const existing = byEpoch.get(bundle.contentKeyEpoch);
    if (!existing) {
      byEpoch.set(bundle.contentKeyEpoch, bundle);
      continue;
    }
    if (
      serializeCanonical(existing, "content-key bundle") !==
      serializeCanonical(bundle, "content-key bundle")
    ) {
      throw new Error("Document sync response content-key bundle conflict");
    }
  }

  return byEpoch;
}

function syncResponseUpdatesByContentKeyEpoch(
  response: DocumentSyncResponse,
): ReadonlyMap<number, readonly SyncResponseUpdate[]> {
  const updatesByEpoch = new Map<number, SyncResponseUpdate[]>();
  for (const update of response.updates) {
    let contentKeyEpoch: number;
    try {
      contentKeyEpoch = readWriteHeader(
        update.writeHeader,
        "Document sync response write header",
      ).contentKeyEpoch;
    } catch (error) {
      throw isolateDocumentSyncUpdateError({
        cause: error,
        responseUpdate: update,
        stage: "write_header",
        updateId: update.id,
      });
    }
    const epochUpdates = updatesByEpoch.get(contentKeyEpoch);
    if (epochUpdates) epochUpdates.push(update);
    else updatesByEpoch.set(contentKeyEpoch, [update]);
  }
  return updatesByEpoch;
}

/** @internal Keeps epoch-wide failures anonymous and integrity failures typed. */
export function throwDocumentSyncContentKeyFailure(input: {
  cause: unknown;
  updates: readonly SyncResponseUpdate[];
}): never {
  if (isKeyingVerificationError(input.cause)) {
    throw input.cause;
  }
  if (
    input.cause instanceof DocumentHistoryUnavailableError &&
    isKeyingVerificationError(input.cause.historyCause)
  ) {
    throw input.cause.historyCause;
  }
  throw isolateDocumentSyncBatchError({
    cause: input.cause,
    stage: "content_key",
    updateIds: input.updates.map((update) => update.id),
  });
}

export async function unwrapDocumentSyncResponseContentKeys(
  input: {
    currentContentKey: Uint8Array;
    currentContentKeyEpoch: number;
    execSql?: ExecSql | undefined;
    historyMode?: "raw" | undefined;
    response: DocumentSyncResponse;
    targetSecretKey: Uint8Array;
    writerProjection: DocumentWriterProjectionResponse;
  } & ProjectionVerificationOptions,
): Promise<ReadonlyMap<number, Uint8Array>> {
  // A stale read-only pass can carry an empty placeholder when none of its
  // authorizing paths reaches the bundle target. Do not mark that epoch as
  // resolved: every served update must instead unwrap its bundle through the
  // verified predecessor KEK chain or fail with an honest error.
  const contentKeysByEpoch = new Map<number, Uint8Array>(
    input.currentContentKey.byteLength > 0
      ? [[input.currentContentKeyEpoch, input.currentContentKey]]
      : [],
  );
  const updatesByContentKeyEpoch = syncResponseUpdatesByContentKeyEpoch(
    input.response,
  );
  const missingContentKeyEpochs = [...updatesByContentKeyEpoch.keys()].filter(
    (contentKeyEpoch) => !contentKeysByEpoch.has(contentKeyEpoch),
  );
  missingContentKeyEpochs.sort((left, right) => left - right);
  if (missingContentKeyEpochs.length === 0) {
    return contentKeysByEpoch;
  }
  const missingUpdates = missingContentKeyEpochs.flatMap(
    (contentKeyEpoch) => updatesByContentKeyEpoch.get(contentKeyEpoch) ?? [],
  );
  let bundlesByEpoch: ReturnType<typeof syncResponseContentKeyBundlesByEpoch>;
  try {
    bundlesByEpoch = syncResponseContentKeyBundlesByEpoch(input.response);
  } catch (error) {
    throwDocumentSyncContentKeyFailure({
      cause: error,
      updates: missingUpdates,
    });
  }
  const collectedKeks = await collectContainerKeksForDocumentSync({
    execSql: input.execSql,
    secretKey: input.targetSecretKey,
    writerProjection: input.writerProjection,
    ...projectionVerificationOptions(input),
  });

  for (const contentKeyEpoch of missingContentKeyEpochs) {
    const bundle = bundlesByEpoch.get(contentKeyEpoch);
    const responseUpdates =
      updatesByContentKeyEpoch.get(contentKeyEpoch) ?? missingUpdates;
    if (!bundle) {
      const error = new Error(
        "Document sync response content-key bundle missing",
      );
      throwDocumentSyncContentKeyFailure({
        cause: error,
        updates: responseUpdates,
      });
    }
    try {
      contentKeysByEpoch.set(
        bundle.contentKeyEpoch,
        await unwrapDocumentContentKeyFromBundle(
          bundle,
          collectedKeks.keksByEpochId,
          collectedKeks.predecessorFailuresByEpochId,
          collectedKeks.unattributedPredecessorFailuresByContainerId,
        ),
      );
    } catch (error) {
      if (
        input.historyMode === "raw" &&
        error instanceof DocumentContentKeyUnavailableError
      ) {
        throw new DocumentRawHistoryUnavailableError(contentKeyEpoch, error);
      }
      throwDocumentSyncContentKeyFailure({
        cause: error,
        updates: responseUpdates,
      });
    }
  }

  return contentKeysByEpoch;
}
