import type { BlobEnvelopeV2Header } from "@tearleads/crypto";
import {
  AES_GCM_TAG_BYTES,
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

/**
 * The metadata hash both the fixture envelope and the signed write header
 * carry. They must agree or every bind fails with an envelope mismatch, so
 * every caller derives it here rather than restating the recipe.
 */
export function fixtureBlobMetadataHash(blobId: string): Promise<string> {
  return computeKeyingDomainHash("tearleads.keying.access-event-body", {
    blobId,
    purpose: "ownership-regression",
  });
}

/** Valid public framing with opaque ciphertext for API tests that do not decrypt. */
export async function createBlobEnvelopeFixture(input: {
  readonly blobId: string;
  readonly organizationId: string;
  readonly contentKeyEpoch?: number;
  /** Plaintext size; the body is this plus one AES-GCM tag. */
  readonly byteLength?: number;
  /** Overwrites single header fields so a test can vary exactly one. */
  readonly overrides?: Partial<BlobEnvelopeV2Header>;
}) {
  const contentKeyEpoch = input.contentKeyEpoch ?? 1;
  const byteLength = input.byteLength ?? 32;
  const headerBytes = encodeBlobEnvelopeV2Header({
    blobId: input.blobId,
    byteLength,
    chunkCount: 1,
    chunkSize: BLOB_CHUNK_SIZE_BYTES,
    contentKeyEpoch,
    contentRecordId: input.blobId,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    format: BLOB_ENCRYPTED_BYTES_FORMAT,
    iv: "AAAAAAAAAAAAAAAA",
    metadataHash: await fixtureBlobMetadataHash(input.blobId),
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
    ...input.overrides,
  });
  return {
    bytes: joinBlobPartBytes(
      headerBytes,
      new Uint8Array(byteLength + AES_GCM_TAG_BYTES),
    ),
    envelopeHeader: parseBlobEnvelopeV2Header(headerBytes),
  };
}
