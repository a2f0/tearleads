import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  createAesGcmIv,
  type KeyingCanonicalJson,
  serializeKeyingCanonicalJson,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { BlobContentKeyBundleRequest } from "@tearleads/validators/request";
import type { BlobBytes } from "../../../blobs";
import { readCanonicalJson } from "../../../keyingCanonicalJson";
import { asWebCryptoBytes } from "../../shared/readers";
import type { BlobEncryptedBytes } from "./types";
import {
  BLOB_CONTENT_RECORD_AAD_DOMAIN,
  BLOB_CONTENT_RECORD_HKDF_SALT,
  BLOB_CONTENT_RECORD_KEY_INFO_DOMAIN,
  BLOB_CONTENT_RECORD_METADATA_HASH_DOMAIN,
  BLOB_ENCRYPTED_BYTES_FORMAT,
  TEXT_ENCODER,
} from "./types";

export async function blobContentMetadataHash(input: {
  blobId: string;
  byteLength: number;
  contentKeyEpoch: number;
  targetHash: string;
}): Promise<string> {
  return toFingerprint(
    TEXT_ENCODER.encode(
      serializeKeyingCanonicalJson({
        domain: BLOB_CONTENT_RECORD_METADATA_HASH_DOMAIN,
        payload: {
          version: 1,
          recordKind: "blob_bytes",
          blobId: input.blobId,
          byteLength: input.byteLength,
          contentKeyEpoch: input.contentKeyEpoch,
          targetHash: input.targetHash,
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
    version: 1,
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
  contentKeyEpoch: number;
  contentRecordId: string;
  metadataHash: string;
  nonceDomainHash: string;
  organizationId: string;
}): Uint8Array<ArrayBuffer> {
  return TEXT_ENCODER.encode(
    serializeKeyingCanonicalJson({
      domain: BLOB_CONTENT_RECORD_AAD_DOMAIN,
      payload: {
        ...contentRecordDerivationPayload(input),
        metadataHash: input.metadataHash,
        nonceDomainHash: input.nonceDomainHash,
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
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    [input.usage],
  );
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function encryptBlobBytes(input: {
  blobId: string;
  bytes: BlobBytes;
  contentKey: Uint8Array;
  contentKeyBundle: BlobContentKeyBundleRequest;
  organizationId: string;
}): Promise<BlobEncryptedBytes> {
  const contentRecordId = input.blobId;
  const { contentKeyEpoch, targetHash } = input.contentKeyBundle;
  const nonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 1,
    organizationId: input.organizationId,
    objectKind: "blob",
    objectId: input.blobId,
    contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId,
  });
  const metadataHash = await blobContentMetadataHash({
    blobId: input.blobId,
    byteLength: input.bytes.byteLength,
    contentKeyEpoch,
    targetHash,
  });
  const contentKeyMaterial = await importBlobContentKeyMaterial(
    input.contentKey,
  );
  const recordKey = await deriveBlobContentRecordKey({
    blobId: input.blobId,
    contentKeyEpoch,
    contentKeyMaterial,
    contentRecordId,
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
          blobId: input.blobId,
          contentKeyEpoch,
          contentRecordId,
          metadataHash,
          nonceDomainHash,
          organizationId: input.organizationId,
        }),
      },
      recordKey,
      asWebCryptoBytes(input.bytes),
    ),
  );
  const encryptedBytes = serializeKeyingCanonicalJson({
    format: BLOB_ENCRYPTED_BYTES_FORMAT,
    version: 1,
    blobId: input.blobId,
    byteLength: input.bytes.byteLength,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentKeyEpoch,
    contentRecordId,
    nonceDomainHash,
    metadataHash,
    targetHash,
    contentKeyBundle: readCanonicalJson(
      input.contentKeyBundle,
      "Blob encrypted bytes content-key bundle",
    ),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  });

  const encoded = TEXT_ENCODER.encode(encryptedBytes);
  return {
    encryptedBytes,
    metadataHash,
    sha256: await sha256Hex(encoded),
    byteLength: encoded.byteLength,
  };
}
