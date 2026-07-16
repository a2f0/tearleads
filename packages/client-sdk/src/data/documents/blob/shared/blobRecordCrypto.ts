import {
  AES_GCM_IV_BYTES,
  assertAesGcmIv,
  CONTENT_RECORD_ENCRYPTION_SUITE,
  type KeyingCanonicalJson,
  serializeKeyingCanonicalJson,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { asWebCryptoBytes } from "../../shared/readers";
import {
  BLOB_CONTENT_RECORD_AAD_DOMAIN,
  BLOB_CONTENT_RECORD_HKDF_SALT,
  BLOB_CONTENT_RECORD_KEY_INFO_DOMAIN,
  BLOB_CONTENT_RECORD_METADATA_HASH_DOMAIN,
  BLOB_CONTENT_RECORD_NONCE_DOMAIN,
  BLOB_ENCRYPTED_BYTES_FORMAT,
  BLOB_ENCRYPTED_BYTES_VERSION,
  TEXT_ENCODER,
} from "./types";

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export async function deriveBlobBaseIv(input: {
  readonly nonceSeed: Uint8Array;
  readonly plaintextSha256: string;
}): Promise<Uint8Array<ArrayBuffer>> {
  assertAesGcmIv(input.nonceSeed, "Blob nonce seed is invalid");
  if (!SHA256_HEX_PATTERN.test(input.plaintextSha256)) {
    throw new Error("Blob plaintext SHA-256 is invalid");
  }

  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      TEXT_ENCODER.encode(
        serializeKeyingCanonicalJson({
          domain: BLOB_CONTENT_RECORD_NONCE_DOMAIN,
          payload: {
            nonceSeed: bytesToBase64(input.nonceSeed),
            plaintextSha256: input.plaintextSha256,
          },
        }),
      ),
    ),
  );
  return digest.slice(0, AES_GCM_IV_BYTES);
}

export async function blobContentMetadataHash(input: {
  blobId: string;
  byteLength: number;
  chunkCount: number;
  chunkSize: number;
  contentKeyEpoch: number;
}): Promise<string> {
  return toFingerprint(
    TEXT_ENCODER.encode(
      serializeKeyingCanonicalJson({
        domain: BLOB_CONTENT_RECORD_METADATA_HASH_DOMAIN,
        payload: {
          version: BLOB_ENCRYPTED_BYTES_VERSION,
          recordKind: "blob_bytes",
          blobId: input.blobId,
          byteLength: input.byteLength,
          chunkCount: input.chunkCount,
          chunkSize: input.chunkSize,
          contentKeyEpoch: input.contentKeyEpoch,
          format: BLOB_ENCRYPTED_BYTES_FORMAT,
        },
      }),
    ),
  );
}

function contentRecordDerivationPayload(input: {
  blobId: string;
  contentKeyEpoch: number;
  contentRecordId: string;
  organizationId: string;
}): Record<string, KeyingCanonicalJson> {
  return {
    version: BLOB_ENCRYPTED_BYTES_VERSION,
    organizationId: input.organizationId,
    objectKind: "blob",
    objectId: input.blobId,
    contentKeyEpoch: input.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: input.contentRecordId,
  };
}

function contentRecordDerivationBytes(input: {
  blobId: string;
  contentKeyEpoch: number;
  contentRecordId: string;
  organizationId: string;
}): Uint8Array<ArrayBuffer> {
  return TEXT_ENCODER.encode(
    serializeKeyingCanonicalJson({
      domain: BLOB_CONTENT_RECORD_KEY_INFO_DOMAIN,
      payload: contentRecordDerivationPayload(input),
    }),
  );
}

export function contentRecordAdditionalDataBytes(input: {
  blobId: string;
  chunkCount: number;
  chunkIndex: number;
  chunkPlaintextByteLength: number;
  chunkSize: number;
  contentKeyEpoch: number;
  contentRecordId: string;
  metadataHash: string;
  nonceDomainHash: string;
  organizationId: string;
  plaintextByteLength: number;
}): Uint8Array<ArrayBuffer> {
  return TEXT_ENCODER.encode(
    serializeKeyingCanonicalJson({
      domain: BLOB_CONTENT_RECORD_AAD_DOMAIN,
      payload: {
        ...contentRecordDerivationPayload(input),
        blobFormat: BLOB_ENCRYPTED_BYTES_FORMAT,
        blobFormatVersion: BLOB_ENCRYPTED_BYTES_VERSION,
        chunkCount: input.chunkCount,
        chunkIndex: input.chunkIndex,
        chunkPlaintextByteLength: input.chunkPlaintextByteLength,
        chunkSize: input.chunkSize,
        metadataHash: input.metadataHash,
        nonceDomainHash: input.nonceDomainHash,
        plaintextByteLength: input.plaintextByteLength,
      },
    }),
  );
}

export async function importBlobContentKeyMaterial(
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

export async function deriveBlobContentRecordKey(input: {
  blobId: string;
  contentKeyEpoch: number;
  contentKeyMaterial: CryptoKey;
  contentRecordId: string;
  organizationId: string;
  usage: "decrypt" | "encrypt";
}): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: BLOB_CONTENT_RECORD_HKDF_SALT,
      info: contentRecordDerivationBytes(input),
    },
    input.contentKeyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    [input.usage],
  );
}
