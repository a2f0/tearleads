import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type {
  DocumentCreateResponse,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { importDocumentContentKeyMaterial } from "../../data/documents/shared/contentRecordKeys";
import { encryptDocumentPendingUpdate } from "../../data/documents/shared/crypto";
import {
  collectContainerKeksForDocumentSync,
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
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

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
  const contentKeyMaterial = await importDocumentContentKeyMaterial(
    input.contentKey,
  );

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

export async function unwrapDocumentSyncResponseContentKeys(
  input: {
    currentContentKey: Uint8Array;
    currentContentKeyEpoch: number;
    execSql?: ExecSql | undefined;
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
  const bundlesByEpoch = syncResponseContentKeyBundlesByEpoch(input.response);
  const neededContentKeyEpochs = new Set(
    input.response.updates.map(
      (update) =>
        readWriteHeader(
          update.writeHeader,
          "Document sync response write header",
        ).contentKeyEpoch,
    ),
  );
  const missingBundles = [...neededContentKeyEpochs]
    .filter((contentKeyEpoch) => !contentKeysByEpoch.has(contentKeyEpoch))
    .map((contentKeyEpoch) => bundlesByEpoch.get(contentKeyEpoch));
  if (missingBundles.length === 0) {
    return contentKeysByEpoch;
  }

  const collectedKeks = await collectContainerKeksForDocumentSync({
    execSql: input.execSql,
    secretKey: input.targetSecretKey,
    writerProjection: input.writerProjection,
    ...projectionVerificationOptions(input),
  });

  for (const bundle of missingBundles) {
    if (!bundle) {
      throw new Error("Document sync response content-key bundle missing");
    }
    contentKeysByEpoch.set(
      bundle.contentKeyEpoch,
      await unwrapDocumentContentKeyFromBundle(
        bundle,
        collectedKeks.keksByEpochId,
        collectedKeks.predecessorFailuresByEpochId,
        collectedKeks.unattributedPredecessorFailuresByContainerId,
      ),
    );
  }

  return contentKeysByEpoch;
}

export function contentKeyBundleForSyncRequest(
  input: DocumentCreateResponse["contentKeyBundle"],
): NonNullable<DocumentSyncRequest["contentKeyBundle"]> {
  const { documentId: _omit, ...bundle } = input;
  return bundle;
}
