import {
  BLOB_CHUNK_SIZE_BYTES,
  BLOB_ENCRYPTED_BYTES_FORMAT,
  BLOB_ENCRYPTED_BYTES_VERSION,
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeKeyingDomainHash,
  encodeBlobEnvelopeV2Header,
  joinBlobPartBytes,
  parseBlobEnvelopeV2Header,
} from "@tearleads/crypto";

/** Valid public framing with opaque ciphertext for API tests that do not decrypt. */
export async function createBlobEnvelopeFixture(input: {
  readonly blobId: string;
  readonly organizationId: string;
  readonly contentKeyEpoch?: number;
}) {
  const contentKeyEpoch = input.contentKeyEpoch ?? 1;
  const headerBytes = encodeBlobEnvelopeV2Header({
    blobId: input.blobId,
    byteLength: 32,
    chunkCount: 1,
    chunkSize: BLOB_CHUNK_SIZE_BYTES,
    contentKeyEpoch,
    contentRecordId: input.blobId,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    format: BLOB_ENCRYPTED_BYTES_FORMAT,
    iv: "AAAAAAAAAAAAAAAA",
    metadataHash: await computeKeyingDomainHash(
      "tearleads.keying.access-event-body",
      { blobId: input.blobId, purpose: "ownership-regression" },
    ),
    nonceDomainHash: await computeContentRecordNonceDomainHash({
      version: 1,
      organizationId: input.organizationId,
      objectKind: "blob",
      objectId: input.blobId,
      contentKeyEpoch,
      encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
      contentRecordId: input.blobId,
    }),
    version: BLOB_ENCRYPTED_BYTES_VERSION,
  });
  return {
    bytes: joinBlobPartBytes(headerBytes, new Uint8Array(48)),
    envelopeHeader: parseBlobEnvelopeV2Header(headerBytes),
  };
}
