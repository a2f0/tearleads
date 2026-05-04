import {
  assertAesGcmIv,
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeDocumentContentRecordCiphertextHash,
  computeDocumentContentRecordMetadataHash,
  createAesGcmIv,
  type KeyingCanonicalJson,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import type { PendingUpdateRecord } from "../../persistence/documentPersistence";
import {
  assertOnlyRecordKeys,
  asWebCryptoBytes,
  readRecordNumber,
  readRecordString,
} from "./readers";
import {
  type DecryptedDocumentSyncUpdate,
  DOCUMENT_CONTENT_RECORD_AAD_DOMAIN,
  DOCUMENT_CONTENT_RECORD_HKDF_SALT,
  DOCUMENT_CONTENT_RECORD_KEY_INFO_DOMAIN,
  DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT,
  DOCUMENT_ENCRYPTED_UPDATE_KEYS,
  type DocumentEncryptedPendingUpdate,
  type ParsedDocumentEncryptedUpdate,
  TEXT_ENCODER,
} from "./types";

function contentRecordDerivationPayload(input: {
  contentKeyEpoch: number;
  contentRecordId: string;
  documentId: string;
  organizationId: string;
}): Record<string, KeyingCanonicalJson> {
  return {
    version: 1,
    organizationId: input.organizationId,
    objectKind: "document",
    objectId: input.documentId,
    contentKeyEpoch: input.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: input.contentRecordId,
  };
}

function contentRecordDerivationBytes(input: {
  contentKeyEpoch: number;
  contentRecordId: string;
  documentId: string;
  organizationId: string;
}): Uint8Array<ArrayBuffer> {
  return TEXT_ENCODER.encode(
    serializeKeyingCanonicalJson({
      domain: DOCUMENT_CONTENT_RECORD_KEY_INFO_DOMAIN,
      payload: contentRecordDerivationPayload(input),
    }),
  );
}

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
        ...contentRecordDerivationPayload(input),
        metadataHash: input.metadataHash,
        nonceDomainHash: input.nonceDomainHash,
      },
    }),
  );
}

async function deriveDocumentContentRecordKey(input: {
  contentKeyMaterial: CryptoKey;
  contentKeyEpoch: number;
  contentRecordId: string;
  documentId: string;
  organizationId: string;
  usage: "decrypt" | "encrypt";
}): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: DOCUMENT_CONTENT_RECORD_HKDF_SALT,
      info: contentRecordDerivationBytes(input),
    },
    input.contentKeyMaterial,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    [input.usage],
  );
}

export async function importDocumentContentKeyMaterial(
  contentKey: Uint8Array,
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    asWebCryptoBytes(contentKey),
    "HKDF",
    false,
    ["deriveKey"],
  );
}

export async function encryptDocumentPendingUpdate(input: {
  contentKeyMaterial: CryptoKey;
  contentKeyEpoch: number;
  documentId: string;
  organizationId: string;
  update: PendingUpdateRecord;
}): Promise<DocumentEncryptedPendingUpdate> {
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
  const metadataHash = await computeDocumentContentRecordMetadataHash({
    documentId: input.documentId,
    partialEndVersionVector: input.update.partialEndVersionVector,
    partialStartVersionVector: input.update.partialStartVersionVector,
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
      asWebCryptoBytes(base64ToBytes(input.update.updateData)),
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
  const version = readRecordNumber(
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
    contentKeyEpoch: readRecordNumber(
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
    documentId: input.documentId,
    partialEndVersionVector: update.partialEndVersionVector,
    partialStartVersionVector: update.partialStartVersionVector,
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
  const recordKey = await deriveDocumentContentRecordKey({
    contentKeyMaterial: input.contentKeyMaterial,
    contentKeyEpoch: input.contentKeyEpoch,
    contentRecordId: encrypted.contentRecordId,
    documentId: input.documentId,
    organizationId: input.organizationId,
    usage: "decrypt",
  });
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

  return {
    id: input.update.id,
    partialEndVersionVector: input.update.partialEndVersionVector,
    partialStartVersionVector: input.update.partialStartVersionVector,
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
  if (input.updates.length === 0) {
    return [];
  }
  const contentKeyMaterial = await importDocumentContentKeyMaterial(
    input.contentKey,
  );

  return Promise.all(
    input.updates.map((update) =>
      decryptDocumentSyncUpdate({
        contentKeyMaterial,
        contentKeyEpoch: input.contentKeyEpoch,
        documentId: input.documentId,
        organizationId: input.organizationId,
        update,
      }),
    ),
  );
}
