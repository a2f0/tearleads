import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeDocumentContentRecordCiphertextHash,
  computeDocumentContentRecordMetadataHash,
  type ParsedDocumentEncryptedUpdate,
  parseDocumentEncryptedUpdate,
} from "@tearleads/crypto";
import { versionVectorsEqual } from "@tearleads/loro";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { contentRecordAdditionalDataBytes } from "../contentRecordAdditionalData";
import {
  deriveDocumentContentRecordKey,
  deriveDocumentPlaintextHashKey,
} from "../contentRecordKeys";
import { assertDecryptedDocumentUpdateMetadata } from "../documentUpdateIntegrity";
import { assertDocumentUpdatePlaintextHash } from "../plaintextHash";
import {
  asWebCryptoBytes,
  readRecordString,
  readWriteHeader,
} from "../readers";
import type { DocumentContentKey } from "./contentKeyCommitment";
import type { DecryptedDocumentSyncUpdate } from "./documentSyncTypes";
import { isolateDocumentSyncUpdateError } from "./documentSyncUpdateIsolation";

type SyncResponseUpdate = DocumentSyncResponse["updates"][number];

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
    update.sourceVersionVector !== undefined ||
    update.coversThroughUpdateId !== undefined;
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
    coversThroughUpdateId: update.coversThroughUpdateId,
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

/**
 * The envelope's signed commitment must name the key this reader holds for
 * its epoch. Checked only after the envelope matched its signed header and
 * `ciphertextHash`, so a commitment the server altered fails that check
 * instead. A mismatch means this reader holds another key than the writer
 * committed to: it can judge nothing about the update, so it is no void.
 */
function assertEnvelopeCommitsToHeldKey(input: {
  contentKey: DocumentContentKey;
  encrypted: ParsedDocumentEncryptedUpdate;
  update: SyncResponseUpdate;
}): void {
  if (input.encrypted.contentKeyCommitment === input.contentKey.commitment) {
    return;
  }
  throw isolateDocumentSyncUpdateError({
    cause: new Error(
      "Document update commits to another content key than this reader holds",
    ),
    responseUpdate: input.update,
    stage: "content_key",
    updateId: input.update.id,
  });
}

/**
 * AES-GCM refusing the record: a failed tag check, or a ciphertext too short
 * to hold one. WebCrypto reports both, and only these, as `OperationError`.
 */
function isAesGcmAuthenticationFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    Reflect.get(error, "name") === "OperationError"
  );
}

async function decryptPayload(input: {
  contentKey: DocumentContentKey;
  contentKeyEpoch: number;
  documentId: string;
  encrypted: ParsedDocumentEncryptedUpdate;
  organizationId: string;
  update: SyncResponseUpdate;
}): Promise<{ plaintextHashKey: CryptoKey; updateData: Uint8Array }> {
  const isolate = (cause: unknown, stage: "decrypt" | "decrypt_runtime") =>
    isolateDocumentSyncUpdateError({
      cause,
      responseUpdate: input.update,
      stage,
      updateId: input.update.id,
    });
  let recordKey: CryptoKey;
  let plaintextHashKey: CryptoKey;
  try {
    const keyInput = {
      contentKeyMaterial: input.contentKey.material,
      contentKeyEpoch: input.contentKeyEpoch,
      contentRecordId: input.encrypted.contentRecordId,
      documentId: input.documentId,
      organizationId: input.organizationId,
    };
    [recordKey, plaintextHashKey] = await Promise.all([
      deriveDocumentContentRecordKey({ ...keyInput, usage: "decrypt" }),
      deriveDocumentPlaintextHashKey(keyInput),
    ]);
  } catch (error) {
    throw isolate(error, "decrypt_runtime");
  }
  try {
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
    // Under the committed key, a refused record is the writer's: every
    // reader holding that key refuses it. Anything else is this runtime's.
    throw isolate(
      error,
      isAesGcmAuthenticationFailure(error) ? "decrypt" : "decrypt_runtime",
    );
  }
}

/**
 * Decrypts a served update and checks its plaintext hash. The envelope must
 * first match its signed header and commit to the key this reader holds.
 * With `verifyLoroMetadata` it also checks that the payload's Loro metadata
 * is the signed span; a judged pull leaves that to the import judge, which
 * reads every payload in server order and can tell a void from the runtime
 * failing.
 */
export async function decryptDocumentSyncUpdate(input: {
  /** The reader's key for the update's epoch, opened for this document. */
  contentKey: DocumentContentKey;
  contentKeyEpoch: number;
  documentId: string;
  organizationId: string;
  update: SyncResponseUpdate;
  verifyLoroMetadata: boolean;
}): Promise<DecryptedDocumentSyncUpdate> {
  const encrypted = await verifiedEncryptedSyncUpdate(input);
  assertEnvelopeCommitsToHeldKey({ ...input, encrypted });
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
    if (input.verifyLoroMetadata) {
      assertDecryptedDocumentUpdateMetadata(updateData, input.update);
    }
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
