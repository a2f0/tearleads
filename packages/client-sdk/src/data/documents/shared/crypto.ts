import {
  assertAesGcmIv,
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeDocumentContentRecordCiphertextHash,
  computeDocumentContentRecordMetadataHash,
  computeDocumentContentRecordPlaintextHash,
  createAesGcmIv,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { versionVectorsEqual } from "@tearleads/loro";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import type { PendingUpdateRecord } from "../../sqlite/documentPersistence";
import {
  deriveDocumentContentRecordKey,
  deriveDocumentPlaintextHashKey,
  documentContentRecordDerivationPayload,
  importDocumentContentKeyMaterial,
} from "./contentRecordKeys";
import { assertDecryptedDocumentUpdateMetadata } from "./documentUpdateIntegrity";
import { assertDocumentUpdatePlaintextHash } from "./plaintextHash";
import {
  assertOnlyRecordKeys,
  asWebCryptoBytes,
  readRecordPositiveInteger,
  readRecordString,
  readWriteHeader,
} from "./readers";
import {
  type DecryptedDocumentSyncUpdate,
  DOCUMENT_CONTENT_RECORD_AAD_DOMAIN,
  DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT,
  DOCUMENT_ENCRYPTED_UPDATE_KEYS,
  type DocumentEncryptedPendingUpdate,
  type ParsedDocumentEncryptedUpdate,
  TEXT_ENCODER,
} from "./types";

function contentRecordAdditionalDataBytes(input: {
  contentKeyEpoch: number;
  contentRecordId: string;
  documentId: string;
  metadataHash: string;
  nonceDomainHash: string;
  organizationId: string;
}): Uint8Array<ArrayBuffer> {
  return TEXT_ENCODER.encode(
    serializeKeyingCanonicalJson({
      domain: DOCUMENT_CONTENT_RECORD_AAD_DOMAIN,
      payload: {
        ...documentContentRecordDerivationPayload(input),
        metadataHash: input.metadataHash,
        nonceDomainHash: input.nonceDomainHash,
      },
    }),
  );
}

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

function parseDocumentEncryptedUpdate(
  encryptedData: string,
): ParsedDocumentEncryptedUpdate {
  let value: unknown;
  try {
    value = JSON.parse(encryptedData);
  } catch {
    throw new Error("Document encrypted update is invalid JSON");
  }
  if (!isPlainRecord(value)) {
    throw new Error("Document encrypted update must be an object");
  }
  assertOnlyRecordKeys(
    value,
    DOCUMENT_ENCRYPTED_UPDATE_KEYS,
    "Document encrypted update",
  );
  if (
    readRecordString(value, "format", "Document encrypted update") !==
    DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT
  ) {
    throw new Error("Document encrypted update format is invalid");
  }
  const version = readRecordPositiveInteger(
    value,
    "version",
    "Document encrypted update",
  );
  if (version !== 1) {
    throw new Error(
      `Document encrypted update version ${version} is invalid; expected 1`,
    );
  }
  if (
    readRecordString(value, "encryptionSuite", "Document encrypted update") !==
    CONTENT_RECORD_ENCRYPTION_SUITE
  ) {
    throw new Error("Document encrypted update suite is invalid");
  }

  const iv = base64ToBytes(
    readRecordString(value, "iv", "Document encrypted update"),
  );
  assertAesGcmIv(iv, "Document encrypted update IV is invalid");

  return {
    ciphertext: base64ToBytes(
      readRecordString(value, "ciphertext", "Document encrypted update"),
    ),
    contentKeyEpoch: readRecordPositiveInteger(
      value,
      "contentKeyEpoch",
      "Document encrypted update",
    ),
    contentRecordId: readRecordString(
      value,
      "contentRecordId",
      "Document encrypted update",
    ),
    metadataHash: readRecordString(
      value,
      "metadataHash",
      "Document encrypted update",
    ),
    nonceDomainHash: readRecordString(
      value,
      "nonceDomainHash",
      "Document encrypted update",
    ),
    iv,
  };
}

async function assertDocumentEncryptedUpdateMatchesHeader(input: {
  encrypted: ParsedDocumentEncryptedUpdate;
  encryptedData: string;
  contentKeyEpoch: number;
  documentId: string;
  organizationId: string;
  update: DocumentSyncResponse["updates"][number];
}): Promise<void> {
  const { encrypted, update } = input;
  const hasCheckpointMetadata =
    update.checkpointKind !== undefined ||
    update.checkpointPayloadKind !== undefined ||
    update.sourceVersionVector !== undefined;
  if (
    hasCheckpointMetadata &&
    (update.checkpointKind !== "rotate_baseline" ||
      update.checkpointPayloadKind !== "full_history_snapshot" ||
      !update.sourceVersionVector ||
      !versionVectorsEqual(
        update.sourceVersionVector,
        update.partialEndVersionVector,
      ))
  ) {
    throw new Error("Document rotation checkpoint metadata mismatch");
  }
  if (encrypted.contentKeyEpoch !== input.contentKeyEpoch) {
    throw new Error("Document encrypted update content-key epoch mismatch");
  }
  if (update.documentId !== input.documentId) {
    throw new Error("Document encrypted update document id mismatch");
  }
  const headerContentRecordId = readRecordString(
    update.writeHeader,
    "contentRecordId",
    "write header",
  );
  if (encrypted.contentRecordId !== headerContentRecordId) {
    throw new Error("Document encrypted update content record mismatch");
  }

  // Keep this helper fail-closed even when it is used outside syncRemoteDocument.
  const metadataHash = await computeDocumentContentRecordMetadataHash({
    ...(update.checkpointKind === undefined
      ? {}
      : { checkpointKind: update.checkpointKind }),
    ...(update.checkpointPayloadKind === undefined
      ? {}
      : { checkpointPayloadKind: update.checkpointPayloadKind }),
    documentId: input.documentId,
    partialEndVersionVector: update.partialEndVersionVector,
    partialStartVersionVector: update.partialStartVersionVector,
    plaintextHash: update.plaintextHash,
    ...(update.sourceVersionVector === undefined
      ? {}
      : { sourceVersionVector: update.sourceVersionVector }),
    updateId: update.id,
  });
  if (
    encrypted.metadataHash !== metadataHash ||
    encrypted.metadataHash !==
      readRecordString(update.writeHeader, "metadataHash", "write header")
  ) {
    throw new Error("Document encrypted update metadata hash mismatch");
  }

  const nonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 1,
    organizationId: input.organizationId,
    objectKind: "document",
    objectId: input.documentId,
    contentKeyEpoch: input.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: encrypted.contentRecordId,
  });
  if (
    encrypted.nonceDomainHash !== nonceDomainHash ||
    encrypted.nonceDomainHash !==
      readRecordString(update.writeHeader, "nonceDomainHash", "write header")
  ) {
    throw new Error("Document encrypted update nonce domain mismatch");
  }

  const ciphertextHash = await computeDocumentContentRecordCiphertextHash(
    input.encryptedData,
  );
  if (
    ciphertextHash !==
    readRecordString(update.writeHeader, "ciphertextHash", "write header")
  ) {
    throw new Error("Document encrypted update ciphertext hash mismatch");
  }
}

async function decryptDocumentSyncUpdate(input: {
  contentKeyMaterial: CryptoKey;
  contentKeyEpoch: number;
  documentId: string;
  organizationId: string;
  update: DocumentSyncResponse["updates"][number];
}): Promise<DecryptedDocumentSyncUpdate> {
  const encrypted = parseDocumentEncryptedUpdate(input.update.encryptedData);
  await assertDocumentEncryptedUpdateMatchesHeader({
    encrypted,
    encryptedData: input.update.encryptedData,
    contentKeyEpoch: input.contentKeyEpoch,
    documentId: input.documentId,
    organizationId: input.organizationId,
    update: input.update,
  });
  const [recordKey, plaintextHashKey] = await Promise.all([
    deriveDocumentContentRecordKey({
      contentKeyMaterial: input.contentKeyMaterial,
      contentKeyEpoch: input.contentKeyEpoch,
      contentRecordId: encrypted.contentRecordId,
      documentId: input.documentId,
      organizationId: input.organizationId,
      usage: "decrypt",
    }),
    deriveDocumentPlaintextHashKey({
      contentKeyMaterial: input.contentKeyMaterial,
      contentKeyEpoch: input.contentKeyEpoch,
      contentRecordId: encrypted.contentRecordId,
      documentId: input.documentId,
      organizationId: input.organizationId,
    }),
  ]);
  const updateData = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asWebCryptoBytes(encrypted.iv),
        additionalData: contentRecordAdditionalDataBytes({
          contentKeyEpoch: input.contentKeyEpoch,
          contentRecordId: encrypted.contentRecordId,
          documentId: input.documentId,
          metadataHash: encrypted.metadataHash,
          nonceDomainHash: encrypted.nonceDomainHash,
          organizationId: input.organizationId,
        }),
      },
      recordKey,
      asWebCryptoBytes(encrypted.ciphertext),
    ),
  );

  await assertDocumentUpdatePlaintextHash(
    updateData,
    input.update.plaintextHash,
    plaintextHashKey,
  );

  assertDecryptedDocumentUpdateMetadata(updateData, input.update);

  return {
    ...(input.update.checkpointKind === undefined
      ? {}
      : { checkpointKind: input.update.checkpointKind }),
    ...(input.update.checkpointPayloadKind === undefined
      ? {}
      : { checkpointPayloadKind: input.update.checkpointPayloadKind }),
    id: input.update.id,
    partialEndVersionVector: input.update.partialEndVersionVector,
    partialStartVersionVector: input.update.partialStartVersionVector,
    ...(input.update.sourceVersionVector === undefined
      ? {}
      : { sourceVersionVector: input.update.sourceVersionVector }),
    updateData,
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
    const imported = importDocumentContentKeyMaterial(contentKey);
    contentKeyMaterialByEpoch.set(contentKeyEpoch, imported);
    return imported;
  };

  return Promise.all(
    input.updates.map(async (update) => {
      const header = readWriteHeader(
        update.writeHeader,
        "Document sync response write header",
      );

      return decryptDocumentSyncUpdate({
        contentKeyMaterial: await contentKeyMaterialForEpoch(
          header.contentKeyEpoch,
        ),
        contentKeyEpoch: header.contentKeyEpoch,
        documentId: input.documentId,
        organizationId: input.organizationId,
        update,
      });
    }),
  );
}
