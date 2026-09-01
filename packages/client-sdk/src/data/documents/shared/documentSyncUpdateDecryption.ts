import {
  assertAesGcmIv,
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeDocumentContentRecordCiphertextHash,
  computeDocumentContentRecordMetadataHash,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { versionVectorsEqual } from "@tearleads/loro";
import { isPlainObject as isPlainRecord } from "@tearleads/validators/isPlainObject";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { contentRecordAdditionalDataBytes } from "./contentRecordAdditionalData";
import {
  deriveDocumentContentRecordKey,
  deriveDocumentPlaintextHashKey,
} from "./contentRecordKeys";
import { isolateDocumentSyncUpdateError } from "./documentSyncUpdateIsolation";
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
  DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT,
  DOCUMENT_ENCRYPTED_UPDATE_KEYS,
  type ParsedDocumentEncryptedUpdate,
} from "./types";

type SyncResponseUpdate = DocumentSyncResponse["updates"][number];

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
  contentKeyEpoch: number;
  documentId: string;
  encrypted: ParsedDocumentEncryptedUpdate;
  encryptedData: string;
  organizationId: string;
  update: SyncResponseUpdate;
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
  if (
    encrypted.contentRecordId !==
    readRecordString(update.writeHeader, "contentRecordId", "write header")
  ) {
    throw new Error("Document encrypted update content record mismatch");
  }

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

async function verifiedEncryptedSyncUpdate(input: {
  contentKeyEpoch: number;
  documentId: string;
  organizationId: string;
  update: SyncResponseUpdate;
}): Promise<ParsedDocumentEncryptedUpdate> {
  try {
    const encrypted = parseDocumentEncryptedUpdate(input.update.encryptedData);
    await assertDocumentEncryptedUpdateMatchesHeader({
      encrypted,
      encryptedData: input.update.encryptedData,
      ...input,
    });
    return encrypted;
  } catch (error) {
    throw isolateDocumentSyncUpdateError({
      cause: error,
      responseUpdate: input.update,
      stage: "encrypted_record",
      updateId: input.update.id,
    });
  }
}

/** Verifies the encrypted record's structure and every binding to its header. */
export async function assertDocumentSyncUpdateEncryptedRecord(
  update: SyncResponseUpdate,
): Promise<void> {
  let contentKeyEpoch: number;
  let documentId: string;
  let organizationId: string;
  try {
    const header = readWriteHeader(
      update.writeHeader,
      "Document sync response write header",
    );
    if (header.objectKind !== "document") {
      throw new Error("Document sync response write header kind mismatch");
    }
    contentKeyEpoch = header.contentKeyEpoch;
    documentId = header.objectId;
    organizationId = header.organizationId;
  } catch (error) {
    throw isolateDocumentSyncUpdateError({
      cause: error,
      responseUpdate: update,
      stage: "write_header",
      updateId: update.id,
    });
  }
  await verifiedEncryptedSyncUpdate({
    contentKeyEpoch,
    documentId,
    organizationId,
    update,
  });
}

async function decryptPayload(input: {
  contentKeyEpoch: number;
  contentKeyMaterial: CryptoKey;
  documentId: string;
  encrypted: ParsedDocumentEncryptedUpdate;
  organizationId: string;
  update: SyncResponseUpdate;
}): Promise<{ plaintextHashKey: CryptoKey; updateData: Uint8Array }> {
  try {
    const keyInput = {
      contentKeyMaterial: input.contentKeyMaterial,
      contentKeyEpoch: input.contentKeyEpoch,
      contentRecordId: input.encrypted.contentRecordId,
      documentId: input.documentId,
      organizationId: input.organizationId,
    };
    const [recordKey, plaintextHashKey] = await Promise.all([
      deriveDocumentContentRecordKey({ ...keyInput, usage: "decrypt" }),
      deriveDocumentPlaintextHashKey(keyInput),
    ]);
    const updateData = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: asWebCryptoBytes(input.encrypted.iv),
          additionalData: contentRecordAdditionalDataBytes({
            contentKeyEpoch: input.contentKeyEpoch,
            contentRecordId: input.encrypted.contentRecordId,
            documentId: input.documentId,
            metadataHash: input.encrypted.metadataHash,
            nonceDomainHash: input.encrypted.nonceDomainHash,
            organizationId: input.organizationId,
          }),
        },
        recordKey,
        asWebCryptoBytes(input.encrypted.ciphertext),
      ),
    );
    return { plaintextHashKey, updateData };
  } catch (error) {
    throw isolateDocumentSyncUpdateError({
      cause: error,
      responseUpdate: input.update,
      stage: "decrypt",
      updateId: input.update.id,
    });
  }
}

export async function decryptDocumentSyncUpdate(input: {
  contentKeyEpoch: number;
  contentKeyMaterial: CryptoKey;
  documentId: string;
  organizationId: string;
  update: SyncResponseUpdate;
}): Promise<DecryptedDocumentSyncUpdate> {
  const encrypted = await verifiedEncryptedSyncUpdate(input);
  const { plaintextHashKey, updateData } = await decryptPayload({
    ...input,
    encrypted,
  });
  try {
    await assertDocumentUpdatePlaintextHash(
      updateData,
      input.update.plaintextHash,
      plaintextHashKey,
    );
  } catch (error) {
    throw isolateDocumentSyncUpdateError({
      cause: error,
      responseUpdate: input.update,
      stage: "plaintext_integrity",
      updateId: input.update.id,
    });
  }
  try {
    assertDecryptedDocumentUpdateMetadata(updateData, input.update);
  } catch (error) {
    throw isolateDocumentSyncUpdateError({
      cause: error,
      responseUpdate: input.update,
      stage: "loro_metadata",
      updateId: input.update.id,
    });
  }
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
