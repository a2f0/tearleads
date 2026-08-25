import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeDocumentContentRecordCiphertextHash,
  computeDocumentContentRecordMetadataHash,
  computeDocumentContentRecordPlaintextHash,
  createAesGcmIv,
  serializeKeyingCanonicalJson,
} from "@symcrypt/crypto";
import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";
import type { DocumentSyncResponse } from "@symcrypt/validators/response";
import type { PendingUpdateRecord } from "../../sqlite/documentPersistence";
import { contentRecordAdditionalDataBytes } from "./contentRecordAdditionalData";
import {
  deriveDocumentContentRecordKey,
  deriveDocumentPlaintextHashKey,
  importContentKeyMaterial,
} from "./contentRecordKeys";
import { decryptDocumentSyncUpdate } from "./documentSyncUpdateDecryption";
import {
  isDocumentSyncUpdateIsolationError,
  isolateDocumentSyncBatchError,
  isolateDocumentSyncUpdateError,
} from "./documentSyncUpdateIsolation";
import { asWebCryptoBytes, readWriteHeader } from "./readers";
import {
  type DecryptedDocumentSyncUpdate,
  DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT,
  type DocumentEncryptedPendingUpdate,
} from "./types";

export async function encryptDocumentPendingUpdate(input: {
  contentKeyMaterial: CryptoKey;
  contentKeyEpoch: number;
  documentId: string;
  organizationId: string;
  update: PendingUpdateRecord;
}): Promise<DocumentEncryptedPendingUpdate> {
  const plaintext = base64ToBytes(input.update.updateData);
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
  const plaintextHashKey = await deriveDocumentPlaintextHashKey({
    contentKeyMaterial: input.contentKeyMaterial,
    contentKeyEpoch: input.contentKeyEpoch,
    contentRecordId,
    documentId: input.documentId,
    organizationId: input.organizationId,
  });
  const plaintextHash = await computeDocumentContentRecordPlaintextHash(
    plaintext,
    plaintextHashKey,
  );
  const metadataHash = await computeDocumentContentRecordMetadataHash({
    ...(input.update.sourceVersionVector
      ? {
          checkpointKind: "rotate_baseline" as const,
          checkpointPayloadKind: "full_history_snapshot" as const,
          sourceVersionVector: input.update.sourceVersionVector,
        }
      : {}),
    documentId: input.documentId,
    partialEndVersionVector: input.update.partialEndVersionVector,
    partialStartVersionVector: input.update.partialStartVersionVector,
    plaintextHash,
    updateId: input.update.id,
  });
  const recordKey = await deriveDocumentContentRecordKey({
    contentKeyMaterial: input.contentKeyMaterial,
    contentKeyEpoch: input.contentKeyEpoch,
    contentRecordId,
    documentId: input.documentId,
    organizationId: input.organizationId,
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
    contentKeyEpoch: input.contentKeyEpoch,
    contentRecordId,
    nonceDomainHash,
    metadataHash,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  });

  return {
    contentRecordId,
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

export async function decryptDocumentSyncUpdatesByEpoch(input: {
  contentKeysByEpoch: ReadonlyMap<number, Uint8Array>;
  documentId: string;
  organizationId: string;
  updates: readonly DocumentSyncResponse["updates"][number][];
}): Promise<DecryptedDocumentSyncUpdate[]> {
  if (input.updates.length === 0) {
    return [];
  }
  const contentKeyMaterialByEpoch = new Map<number, Promise<CryptoKey>>();
  const contentKeyMaterialForEpoch = (contentKeyEpoch: number) => {
    const existing = contentKeyMaterialByEpoch.get(contentKeyEpoch);
    if (existing) {
      return existing;
    }

    const contentKey = input.contentKeysByEpoch.get(contentKeyEpoch);
    if (!contentKey) {
      throw new Error("Document content key missing for sync update epoch");
    }
    const imported = importContentKeyMaterial(contentKey);
    contentKeyMaterialByEpoch.set(contentKeyEpoch, imported);
    return imported;
  };

  const inspections = await Promise.allSettled(
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

      let contentKeyMaterial: CryptoKey;
      try {
        contentKeyMaterial = await contentKeyMaterialForEpoch(contentKeyEpoch);
      } catch (error) {
        throw isolateDocumentSyncUpdateError({
          cause: error,
          responseUpdate: update,
          stage: "content_key",
          updateId: update.id,
        });
      }

      return decryptDocumentSyncUpdate({
        contentKeyMaterial,
        contentKeyEpoch,
        documentId: input.documentId,
        organizationId: input.organizationId,
        update,
      });
    }),
  );
  const failures = inspections.flatMap((inspection, index) =>
    inspection.status === "rejected"
      ? [{ index, reason: inspection.reason }]
      : [],
  );
  const firstFailure = failures[0];
  if (failures.length === 1 && firstFailure) {
    throw firstFailure.reason;
  }
  if (failures.length > 1 && firstFailure) {
    const stage =
      isDocumentSyncUpdateIsolationError(firstFailure.reason) &&
      failures.every(
        ({ reason }) =>
          isDocumentSyncUpdateIsolationError(reason) &&
          reason.stage === firstFailure.reason.stage,
      )
        ? firstFailure.reason.stage
        : "decrypt";
    throw isolateDocumentSyncBatchError({
      // The per-update errors carry authenticated writer attribution. Once
      // more than one update fails, retaining those errors beneath an
      // anonymous batch boundary would disclose the very attribution the
      // boundary intentionally withholds.
      cause: new Error(
        "Multiple document sync updates failed decryption inspection",
      ),
      stage,
      updateIds: failures.map(
        ({ index }) => input.updates[index]?.id ?? "unknown",
      ),
    });
  }
  return inspections.map((inspection) => {
    if (inspection.status === "rejected") {
      throw inspection.reason;
    }
    return inspection.value;
  });
}
