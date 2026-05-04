import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
} from "@tearleads/crypto";
import type { BlobBytes } from "../../data/blobs";
import {
  blobContentMetadataHash,
  contentRecordAdditionalDataBytes,
  deriveBlobContentRecordKey,
  importBlobContentKeyMaterial,
} from "../../data/documents/blob/shared/crypto";
import { unwrapBlobContentKey } from "../../data/documents/blob/shared/projection";
import {
  parseBlobEncryptedBytes,
  readDocumentManifestIdentity,
} from "../../data/documents/blob/shared/readers";
import { assertBlobContentKeyBundleTargetHash } from "../../data/documents/blob/shared/responses";
import type { DecryptDocumentAttachmentBlobInput } from "../../data/documents/blob/shared/types";
import { asWebCryptoBytes } from "../../data/documents/shared/readers";
import { requireProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import { assertDocumentWriterProjectionConsistent } from "../documents";

export async function decryptDocumentAttachmentBlob({
  encryptedBytes,
  expectedBindingId,
  expectedBlobId,
  execSql,
  resolveProjectionUserKey,
  targetSecretKey,
  writerProjection,
}: DecryptDocumentAttachmentBlobInput): Promise<BlobBytes> {
  const requiredResolveProjectionUserKey = requireProjectionUserKeyResolver(
    resolveProjectionUserKey,
    "Document attachment blob decrypt",
  );
  const encrypted = parseBlobEncryptedBytes(encryptedBytes);
  if (
    encrypted.blobId !== expectedBlobId ||
    encrypted.contentRecordId !== expectedBlobId
  ) {
    throw new Error("Blob encrypted bytes blob id mismatch");
  }
  if (
    encrypted.contentKeyEpoch !== encrypted.contentKeyBundle.contentKeyEpoch ||
    encrypted.targetHash !== encrypted.contentKeyBundle.targetHash
  ) {
    throw new Error("Blob encrypted bytes content-key bundle mismatch");
  }
  await assertBlobContentKeyBundleTargetHash(encrypted.contentKeyBundle);

  await assertDocumentWriterProjectionConsistent(writerProjection, {
    resolveProjectionUserKey: requiredResolveProjectionUserKey,
  });
  const { documentId, organizationId } =
    readDocumentManifestIdentity(writerProjection);
  const expectedNonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 1,
    organizationId,
    objectKind: "blob",
    objectId: expectedBlobId,
    contentKeyEpoch: encrypted.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: encrypted.contentRecordId,
  });
  if (encrypted.nonceDomainHash !== expectedNonceDomainHash) {
    throw new Error("Blob encrypted bytes nonce domain mismatch");
  }
  const expectedMetadataHash = await blobContentMetadataHash({
    blobId: expectedBlobId,
    byteLength: encrypted.byteLength,
    contentKeyEpoch: encrypted.contentKeyEpoch,
    targetHash: encrypted.targetHash,
  });
  if (encrypted.metadataHash !== expectedMetadataHash) {
    throw new Error("Blob encrypted bytes metadata hash mismatch");
  }

  const contentKey = await unwrapBlobContentKey({
    documentId,
    encrypted,
    execSql,
    expectedBindingId,
    resolveProjectionUserKey: requiredResolveProjectionUserKey,
    secretKey: targetSecretKey,
    writerProjection,
  });
  const contentKeyMaterial = await importBlobContentKeyMaterial(contentKey);
  const recordKey = await deriveBlobContentRecordKey({
    blobId: expectedBlobId,
    contentKeyEpoch: encrypted.contentKeyEpoch,
    contentKeyMaterial,
    contentRecordId: encrypted.contentRecordId,
    organizationId,
    usage: "decrypt",
  });
  const decrypted = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asWebCryptoBytes(encrypted.iv),
        additionalData: contentRecordAdditionalDataBytes({
          blobId: expectedBlobId,
          contentKeyEpoch: encrypted.contentKeyEpoch,
          contentRecordId: encrypted.contentRecordId,
          metadataHash: encrypted.metadataHash,
          nonceDomainHash: encrypted.nonceDomainHash,
          organizationId,
        }),
      },
      recordKey,
      asWebCryptoBytes(encrypted.ciphertext),
    ),
  );

  if (decrypted.byteLength !== encrypted.byteLength) {
    throw new Error("Blob decrypted byte length mismatch");
  }

  return decrypted as BlobBytes;
}
