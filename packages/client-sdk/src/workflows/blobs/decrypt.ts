import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
} from "@tearleads/crypto";
import type { BlobBytes } from "../../data/blobContracts";
import { deriveBlobChunkIv } from "../../data/documents/blob/shared/blobEnvelopeV2";
import {
  blobContentMetadataHash,
  contentRecordAdditionalDataBytes,
  deriveBlobContentRecordKey,
} from "../../data/documents/blob/shared/crypto";
import { unwrapBlobContentKey } from "../../data/documents/blob/shared/projection";
import {
  parseBlobEncryptedBytes,
  readDocumentManifestIdentity,
} from "../../data/documents/blob/shared/readers";
import { assertBlobContentKeyBundleTargetHash } from "../../data/documents/blob/shared/responses";
import type {
  BlobEncryptedBytesRecord,
  DecryptDocumentAttachmentBlobInput,
} from "../../data/documents/blob/shared/types";
import { importContentKeyMaterial } from "../../data/documents/shared/contentRecordKeys";
import { assertDocumentWriterProjectionConsistent } from "../../data/documents/shared/projection";
import { asWebCryptoBytes } from "../../data/documents/shared/readers";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import { requireProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";

async function assertBlobEncryptionMetadata(input: {
  readonly contentKeyBundle: DecryptDocumentAttachmentBlobInput["contentKeyBundle"];
  readonly encrypted: BlobEncryptedBytesRecord;
  readonly expectedBlobId: string;
  readonly organizationId: string;
}): Promise<void> {
  const { contentKeyBundle, encrypted, expectedBlobId, organizationId } = input;
  if (
    encrypted.blobId !== expectedBlobId ||
    encrypted.contentRecordId !== expectedBlobId
  ) {
    throw new Error("Blob encrypted bytes blob id mismatch");
  }
  if (
    encrypted.contentKeyEpoch !== contentKeyBundle.contentKeyEpoch ||
    contentKeyBundle.blobId !== expectedBlobId
  ) {
    throw new Error("Blob encrypted bytes content-key bundle mismatch");
  }
  await assertBlobContentKeyBundleTargetHash(contentKeyBundle);

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
    chunkCount: encrypted.chunkCount,
    chunkSize: encrypted.chunkSize,
    contentKeyEpoch: encrypted.contentKeyEpoch,
  });
  if (encrypted.metadataHash !== expectedMetadataHash) {
    throw new Error("Blob encrypted bytes metadata hash mismatch");
  }
}

async function decryptBlobChunks(input: {
  readonly encrypted: BlobEncryptedBytesRecord;
  readonly expectedBlobId: string;
  readonly organizationId: string;
  readonly recordKey: CryptoKey;
}): Promise<BlobBytes> {
  const { encrypted, expectedBlobId, organizationId, recordKey } = input;
  const decrypted = new Uint8Array(encrypted.byteLength);
  for (const chunk of encrypted.chunks) {
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: deriveBlobChunkIv(encrypted.iv, chunk.index),
          additionalData: contentRecordAdditionalDataBytes({
            blobId: expectedBlobId,
            chunkCount: encrypted.chunkCount,
            chunkIndex: chunk.index,
            chunkPlaintextByteLength: chunk.plaintextByteLength,
            chunkSize: encrypted.chunkSize,
            contentKeyEpoch: encrypted.contentKeyEpoch,
            contentRecordId: encrypted.contentRecordId,
            metadataHash: encrypted.metadataHash,
            nonceDomainHash: encrypted.nonceDomainHash,
            organizationId,
            plaintextByteLength: encrypted.byteLength,
          }),
        },
        recordKey,
        asWebCryptoBytes(chunk.ciphertext),
      ),
    );
    if (plaintext.byteLength !== chunk.plaintextByteLength) {
      throw new Error("Blob decrypted chunk byte length mismatch");
    }
    decrypted.set(plaintext, chunk.index * encrypted.chunkSize);
  }
  return asWebCryptoBytes(decrypted);
}

export async function decryptDocumentAttachmentBlob({
  contentKeyBundle,
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
  const verificationOptions = projectionVerificationOptions({
    execSql,
    resolveProjectionUserKey: requiredResolveProjectionUserKey,
  });
  const encrypted = parseBlobEncryptedBytes(encryptedBytes);
  await assertDocumentWriterProjectionConsistent(writerProjection, {
    execSql,
    ...verificationOptions,
  });
  const { documentId, organizationId } =
    readDocumentManifestIdentity(writerProjection);
  await assertBlobEncryptionMetadata({
    contentKeyBundle,
    encrypted,
    expectedBlobId,
    organizationId,
  });

  const contentKey = await unwrapBlobContentKey({
    contentKeyBundle,
    documentId,
    encrypted,
    execSql,
    expectedBindingId,
    secretKey: targetSecretKey,
    ...verificationOptions,
    writerProjection,
  });
  const contentKeyMaterial = await importContentKeyMaterial(contentKey);
  const recordKey = await deriveBlobContentRecordKey({
    blobId: expectedBlobId,
    contentKeyEpoch: encrypted.contentKeyEpoch,
    contentKeyMaterial,
    contentRecordId: encrypted.contentRecordId,
    organizationId,
    usage: "decrypt",
  });
  return decryptBlobChunks({
    encrypted,
    expectedBlobId,
    organizationId,
    recordKey,
  });
}
