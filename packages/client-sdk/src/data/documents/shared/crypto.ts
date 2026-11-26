import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeDocumentContentRecordCiphertextHash,
  computeDocumentContentRecordMetadataHash,
  computeDocumentContentRecordPlaintextHash,
  createAesGcmIv,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { getImportBlobMetadata } from "@tearleads/loro";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import type { PendingUpdateRecord } from "../../persistence/documents/records";
import { contentRecordAdditionalDataBytes } from "./contentRecordAdditionalData";
import {
  deriveDocumentContentRecordKey,
  deriveDocumentPlaintextHashKey,
} from "./contentRecordKeys";
import { asWebCryptoBytes, readWriteHeader } from "./readers";
import {
  type DocumentBaselineSegmentFields,
  documentBaselineSegmentFields,
} from "./sync/baselineSegment";
import {
  type DocumentContentKey,
  openDocumentContentKey,
} from "./sync/contentKeyCommitment";
import type {
  DecryptedDocumentSyncUpdate,
  DocumentEncryptedPendingUpdate,
} from "./sync/documentSyncTypes";
import { decryptDocumentSyncUpdate } from "./sync/documentSyncUpdateDecryption";
import {
  isDocumentSyncUpdateIsolationError,
  isolateDocumentSyncBatchError,
  isolateDocumentSyncUpdateError,
} from "./sync/documentSyncUpdateIsolation";
import {
  type VoidedDocumentSyncUpdate,
  voidedDocumentSyncUpdate,
} from "./sync/documentUpdateVerdict";
import { DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT } from "./types";

/** The content-record metadata a pending update signs and readers recompute. */
function pendingUpdateMetadataHash(input: {
  baseline?: DocumentBaselineSegmentFields | undefined;
  dependencyVersionVector: string;
  documentId: string;
  plaintextHash: string;
  update: PendingUpdateRecord;
}): Promise<string> {
  return computeDocumentContentRecordMetadataHash({
    ...documentBaselineSegmentFields(input.baseline ?? {}),
    dependencyVersionVector: input.dependencyVersionVector,
    documentId: input.documentId,
    partialEndVersionVector: input.update.partialEndVersionVector,
    partialStartVersionVector: input.update.partialStartVersionVector,
    plaintextHash: input.plaintextHash,
    updateId: input.update.id,
  });
}

export async function encryptDocumentPendingUpdate(input: {
  /** The epoch's key, opened for this document and `contentKeyEpoch`. */
  contentKey: DocumentContentKey;
  contentKeyEpoch: number;
  documentId: string;
  organizationId: string;
  update: PendingUpdateRecord;
  /** The update's place in a rotation baseline, when it is a segment of one. */
  baseline?: DocumentBaselineSegmentFields | undefined;
}): Promise<DocumentEncryptedPendingUpdate> {
  const plaintext = base64ToBytes(input.update.updateData);
  // Declared as Loro decodes the bytes sent, so every reader finds it equal.
  const { dependencyVersionVector } = getImportBlobMetadata(plaintext);
  const contentRecordId = input.update.id;
  const nonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 1,
    organizationId: input.organizationId,
    objectKind: "document",
    objectId: input.documentId,
    contentKeyEpoch: input.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId,
  });
  const keyInput = {
    contentKeyMaterial: input.contentKey.material,
    contentKeyEpoch: input.contentKeyEpoch,
    contentRecordId,
    documentId: input.documentId,
    organizationId: input.organizationId,
  };
  const plaintextHashKey = await deriveDocumentPlaintextHashKey(keyInput);
  const plaintextHash = await computeDocumentContentRecordPlaintextHash(
    plaintext,
    plaintextHashKey,
  );
  const metadataHash = await pendingUpdateMetadataHash({
    ...input,
    dependencyVersionVector,
    plaintextHash,
  });
  const recordKey = await deriveDocumentContentRecordKey({
    ...keyInput,
    usage: "encrypt",
  });
  const iv = createAesGcmIv();
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: contentRecordAdditionalDataBytes({
          contentKeyEpoch: input.contentKeyEpoch,
          contentRecordId,
          documentId: input.documentId,
          metadataHash,
          nonceDomainHash,
          organizationId: input.organizationId,
        }),
      },
      recordKey,
      asWebCryptoBytes(plaintext),
    ),
  );
  const encryptedData = serializeKeyingCanonicalJson({
    format: DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT,
    version: 1,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentKeyCommitment: input.contentKey.commitment,
    contentKeyEpoch: input.contentKeyEpoch,
    contentRecordId,
    nonceDomainHash,
    metadataHash,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  });

  return {
    contentRecordId,
    dependencyVersionVector,
    encryptedData,
    metadataHash,
    plaintextHash,
    ciphertextHash:
      await computeDocumentContentRecordCiphertextHash(encryptedData),
  };
}

export async function decryptDocumentSyncUpdates(input: {
  contentKey: Uint8Array;
  contentKeyEpoch: number;
  documentId: string;
  organizationId: string;
  updates: readonly DocumentSyncResponse["updates"][number][];
}): Promise<DecryptedDocumentSyncUpdate[]> {
  return decryptDocumentSyncUpdatesByEpoch({
    contentKeysByEpoch: new Map([[input.contentKeyEpoch, input.contentKey]]),
    documentId: input.documentId,
    organizationId: input.organizationId,
    updates: input.updates,
  });
}

type SyncResponseUpdate = DocumentSyncResponse["updates"][number];

interface DocumentSyncDecryptionInput {
  contentKeysByEpoch: ReadonlyMap<number, Uint8Array>;
  documentId: string;
  organizationId: string;
  updates: readonly SyncResponseUpdate[];
}

interface InspectionFailure {
  readonly index: number;
  readonly reason: unknown;
}

function inspectDocumentSyncUpdatesByEpoch(
  input: DocumentSyncDecryptionInput,
  verifyLoroMetadata: boolean,
): Promise<PromiseSettledResult<DecryptedDocumentSyncUpdate>[]> {
  const contentKeysByEpoch = new Map<number, Promise<DocumentContentKey>>();
  const contentKeyForEpoch = (contentKeyEpoch: number) => {
    const existing = contentKeysByEpoch.get(contentKeyEpoch);
    if (existing) {
      return existing;
    }

    const contentKey = input.contentKeysByEpoch.get(contentKeyEpoch);
    if (!contentKey) {
      throw new Error("Document content key missing for sync update epoch");
    }
    const opened = openDocumentContentKey({
      contentKey,
      contentKeyEpoch,
      documentId: input.documentId,
    });
    contentKeysByEpoch.set(contentKeyEpoch, opened);
    return opened;
  };

  return Promise.allSettled(
    input.updates.map(async (update) => {
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

      let contentKey: DocumentContentKey;
      try {
        contentKey = await contentKeyForEpoch(contentKeyEpoch);
      } catch (error) {
        throw isolateDocumentSyncUpdateError({
          cause: error,
          responseUpdate: update,
          stage: "content_key",
          updateId: update.id,
        });
      }

      return decryptDocumentSyncUpdate({
        contentKey,
        contentKeyEpoch,
        documentId: input.documentId,
        organizationId: input.organizationId,
        update,
        verifyLoroMetadata,
      });
    }),
  );
}

function throwInspectionFailures(
  failures: readonly InspectionFailure[],
  updates: readonly SyncResponseUpdate[],
): void {
  const firstFailure = failures[0];
  if (failures.length === 1 && firstFailure) {
    throw firstFailure.reason;
  }
  if (failures.length > 1 && firstFailure) {
    const firstReason = firstFailure.reason;
    const stage =
      isDocumentSyncUpdateIsolationError(firstReason) &&
      failures.every(
        ({ reason }) =>
          isDocumentSyncUpdateIsolationError(reason) &&
          reason.stage === firstReason.stage,
      )
        ? firstReason.stage
        : // A batch names no single update, so it is never a verdict.
          "decrypt_runtime";
    throw isolateDocumentSyncBatchError({
      // The per-update errors carry authenticated writer attribution. Once
      // more than one update fails, retaining those errors beneath an
      // anonymous batch boundary would disclose the very attribution the
      // boundary intentionally withholds.
      cause: new Error(
        "Multiple document sync updates failed decryption inspection",
      ),
      stage,
      updateIds: failures.map(({ index }) => updates[index]?.id ?? "unknown"),
    });
  }
}

/** Decrypts a history the caller trusts whole: any failure fails it. */
export async function decryptDocumentSyncUpdatesByEpoch(
  input: DocumentSyncDecryptionInput,
): Promise<DecryptedDocumentSyncUpdate[]> {
  if (input.updates.length === 0) {
    return [];
  }
  const inspections = await inspectDocumentSyncUpdatesByEpoch(input, true);
  throwInspectionFailures(
    inspections.flatMap((inspection, index) =>
      inspection.status === "rejected"
        ? [{ index, reason: inspection.reason }]
        : [],
    ),
    input.updates,
  );
  return inspections.flatMap((inspection) =>
    inspection.status === "fulfilled" ? [inspection.value] : [],
  );
}

/**
 * Decrypts served updates in server order and voids each that fails AES-GCM
 * under the content key its writer signed a commitment to, or whose plaintext
 * is not the one its signed hash names: every reader holding that key reaches
 * the same verdict. Any other failure (a header, an envelope, a key that is
 * not the committed one, or the local runtime) still fails the pass, because
 * it says nothing about the writer. Whether a payload is the Loro update its
 * signed span declares is left to the import judge
 * (`validateDocumentSyncUpdateImports`), the only reader of payloads.
 */
export async function judgeDocumentSyncUpdateDecryption(
  input: DocumentSyncDecryptionInput,
): Promise<{
  accepted: DecryptedDocumentSyncUpdate[];
  voided: VoidedDocumentSyncUpdate[];
}> {
  if (input.updates.length === 0) {
    return { accepted: [], voided: [] };
  }
  const inspections = await inspectDocumentSyncUpdatesByEpoch(input, false);
  const accepted: DecryptedDocumentSyncUpdate[] = [];
  const voided: VoidedDocumentSyncUpdate[] = [];
  const failures: InspectionFailure[] = [];
  for (const [index, inspection] of inspections.entries()) {
    if (inspection.status === "fulfilled") {
      accepted.push(inspection.value);
      continue;
    }
    const voidedUpdate = voidedDocumentSyncUpdate(inspection.reason);
    if (voidedUpdate) {
      voided.push(voidedUpdate);
    } else {
      failures.push({ index, reason: inspection.reason });
    }
  }
  throwInspectionFailures(failures, input.updates);
  return { accepted, voided };
}
