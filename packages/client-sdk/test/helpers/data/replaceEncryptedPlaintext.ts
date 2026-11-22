import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeDocumentContentRecordCiphertextHash,
  createAesGcmIv,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  deriveDocumentContentRecordKey,
  documentContentRecordDerivationPayload,
  importContentKeyMaterial,
} from "../../../src/data/documents/shared/contentRecordKeys";
import {
  DOCUMENT_CONTENT_RECORD_AAD_DOMAIN,
  DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT,
  TEXT_ENCODER,
} from "../../../src/data/documents/shared/types";
import type { createSyncResponse } from "./documentFixtures";

/**
 * Re-encrypts a served update's record over other bytes under the right key,
 * keeping its signed plaintext hash: a writer committing a ciphertext whose
 * payload is not the one its metadata names.
 */
export async function replaceEncryptedPlaintext(input: {
  contentKey: Uint8Array;
  documentId: string;
  organizationId: string;
  update: Awaited<ReturnType<typeof createSyncResponse>>["updates"][number];
}) {
  // Header signature verification is upstream of this unit. Model a writer
  // committing this ciphertext while retaining a hash for different bytes.
  const encrypted = JSON.parse(input.update.encryptedData) as {
    contentKeyEpoch: number;
    contentRecordId: string;
    metadataHash: string;
    nonceDomainHash: string;
  };
  const contentKeyMaterial = await importContentKeyMaterial(input.contentKey);
  const recordKey = await deriveDocumentContentRecordKey({
    contentKeyMaterial,
    contentKeyEpoch: encrypted.contentKeyEpoch,
    contentRecordId: encrypted.contentRecordId,
    documentId: input.documentId,
    organizationId: input.organizationId,
    usage: "encrypt",
  });
  const iv = createAesGcmIv();
  const additionalData = TEXT_ENCODER.encode(
    serializeKeyingCanonicalJson({
      domain: DOCUMENT_CONTENT_RECORD_AAD_DOMAIN,
      payload: {
        ...documentContentRecordDerivationPayload({
          contentKeyEpoch: encrypted.contentKeyEpoch,
          contentRecordId: encrypted.contentRecordId,
          documentId: input.documentId,
          organizationId: input.organizationId,
        }),
        metadataHash: encrypted.metadataHash,
        nonceDomainHash: encrypted.nonceDomainHash,
      },
    }),
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData },
      recordKey,
      new Uint8Array([1, 2, 3]),
    ),
  );
  const encryptedData = serializeKeyingCanonicalJson({
    format: DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT,
    version: 1,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentKeyEpoch: encrypted.contentKeyEpoch,
    contentRecordId: encrypted.contentRecordId,
    nonceDomainHash: encrypted.nonceDomainHash,
    metadataHash: encrypted.metadataHash,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  });
  return {
    ...input.update,
    encryptedData,
    writeHeader: {
      ...input.update.writeHeader,
      ciphertextHash:
        await computeDocumentContentRecordCiphertextHash(encryptedData),
    },
  };
}
