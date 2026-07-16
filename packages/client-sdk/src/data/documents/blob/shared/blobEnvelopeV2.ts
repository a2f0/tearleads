import {
  AES_GCM_IV_BYTES,
  AES_GCM_TAG_BYTES,
  type KeyingCanonicalJson,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import type { BlobBytes } from "../../../blobContracts";
import {
  type BLOB_ENCRYPTED_BYTES_FORMAT,
  BLOB_ENCRYPTED_BYTES_MAGIC,
  type BLOB_ENCRYPTED_BYTES_VERSION,
  TEXT_ENCODER,
} from "./types";

const HEADER_LENGTH_BYTES = 4;
export const BLOB_CHUNK_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_BLOB_CHUNK_COUNT = 10_000;

export interface BlobEnvelopeV2Header {
  readonly blobId: string;
  readonly byteLength: number;
  readonly chunkCount: number;
  readonly chunkSize: number;
  readonly contentKeyEpoch: number;
  readonly contentRecordId: string;
  readonly encryptionSuite: string;
  readonly format: typeof BLOB_ENCRYPTED_BYTES_FORMAT;
  readonly iv: string;
  readonly metadataHash: string;
  readonly nonceDomainHash: string;
  readonly version: typeof BLOB_ENCRYPTED_BYTES_VERSION;
}

export const BLOB_ENVELOPE_MAGIC_BYTES: BlobBytes = TEXT_ENCODER.encode(
  BLOB_ENCRYPTED_BYTES_MAGIC,
);
export const BLOB_ENVELOPE_PREFIX_BYTES =
  BLOB_ENVELOPE_MAGIC_BYTES.byteLength + HEADER_LENGTH_BYTES;

function assertSafeLength(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

export function normalizeBlobChunkSize(chunkSize: number): number {
  if (chunkSize !== BLOB_CHUNK_SIZE_BYTES) {
    throw new Error("Blob chunk size must be exactly 5 MiB");
  }
  return chunkSize;
}

export function computeBlobChunkCount(
  plaintextByteLength: number,
  chunkSize: number,
): number {
  assertSafeLength(plaintextByteLength, "Blob plaintext byte length");
  normalizeBlobChunkSize(chunkSize);
  const chunkCount = Math.max(1, Math.ceil(plaintextByteLength / chunkSize));
  if (chunkCount > MAX_BLOB_CHUNK_COUNT) {
    throw new Error("Blob chunk count exceeds the multipart upload limit");
  }
  return chunkCount;
}

export function blobChunkPlaintextByteLength(input: {
  readonly chunkCount: number;
  readonly chunkIndex: number;
  readonly chunkSize: number;
  readonly plaintextByteLength: number;
}): number {
  if (
    !Number.isInteger(input.chunkIndex) ||
    input.chunkIndex < 0 ||
    input.chunkIndex >= input.chunkCount
  ) {
    throw new Error("Blob chunk index is out of range");
  }
  if (input.chunkIndex < input.chunkCount - 1) {
    return input.chunkSize;
  }
  return input.plaintextByteLength - input.chunkSize * (input.chunkCount - 1);
}

export function encodeBlobEnvelopeV2Header(
  header: BlobEnvelopeV2Header,
): BlobBytes {
  const headerBytes = TEXT_ENCODER.encode(
    serializeKeyingCanonicalJson({
      blobId: header.blobId,
      byteLength: header.byteLength,
      chunkCount: header.chunkCount,
      chunkSize: header.chunkSize,
      contentKeyEpoch: header.contentKeyEpoch,
      contentRecordId: header.contentRecordId,
      encryptionSuite: header.encryptionSuite,
      format: header.format,
      iv: header.iv,
      metadataHash: header.metadataHash,
      nonceDomainHash: header.nonceDomainHash,
      version: header.version,
    } satisfies Record<string, KeyingCanonicalJson>),
  );
  if (headerBytes.byteLength > 0xffff_ffff) {
    throw new Error("Blob envelope header is too large");
  }

  const encoded = new Uint8Array(
    BLOB_ENVELOPE_PREFIX_BYTES + headerBytes.byteLength,
  );
  encoded.set(BLOB_ENVELOPE_MAGIC_BYTES);
  new DataView(encoded.buffer).setUint32(
    BLOB_ENVELOPE_MAGIC_BYTES.byteLength,
    headerBytes.byteLength,
  );
  encoded.set(headerBytes, BLOB_ENVELOPE_PREFIX_BYTES);
  return encoded;
}

export function computeBlobEncryptedByteLength(input: {
  readonly chunkCount: number;
  readonly headerByteLength: number;
  readonly plaintextByteLength: number;
}): number {
  const encryptedByteLength =
    input.headerByteLength +
    input.plaintextByteLength +
    input.chunkCount * AES_GCM_TAG_BYTES;
  assertSafeLength(encryptedByteLength, "Blob encrypted byte length");
  return encryptedByteLength;
}

export function deriveBlobChunkIv(
  baseIv: Uint8Array,
  chunkIndex: number,
): BlobBytes {
  if (baseIv.byteLength !== AES_GCM_IV_BYTES) {
    throw new Error("Blob base IV must be 12 bytes");
  }
  if (
    !Number.isInteger(chunkIndex) ||
    chunkIndex < 0 ||
    chunkIndex > 0xffff_ffff
  ) {
    throw new Error("Blob chunk index exceeds the AES-GCM nonce space");
  }

  const iv = new Uint8Array(baseIv);
  iv[8] = (iv[8] ?? 0) ^ ((chunkIndex >>> 24) & 0xff);
  iv[9] = (iv[9] ?? 0) ^ ((chunkIndex >>> 16) & 0xff);
  iv[10] = (iv[10] ?? 0) ^ ((chunkIndex >>> 8) & 0xff);
  iv[11] = (iv[11] ?? 0) ^ (chunkIndex & 0xff);
  return iv;
}

export function joinBlobPartBytes(
  headerBytes: Uint8Array | null,
  ciphertext: Uint8Array,
): BlobBytes {
  if (!headerBytes) {
    return new Uint8Array(ciphertext);
  }
  const part = new Uint8Array(headerBytes.byteLength + ciphertext.byteLength);
  part.set(headerBytes);
  part.set(ciphertext, headerBytes.byteLength);
  return part;
}
