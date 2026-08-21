import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";
import { isPlainObject } from "@symcrypt/validators/isPlainObject";
import {
  type BlobByteSource,
  type BlobBytes,
  readExactBlobBytes,
} from "../blobContracts";
import {
  readRecordSafeByteLength,
  readRecordSafePositiveInteger,
  readRecordString,
} from "../recordReaders";

export type EncryptedBlobStoreCipher = "aes-256-gcm";

export interface KeyDerivationEnvelope {
  name: "pbkdf2-sha256";
  iterations: number;
  salt: string;
}

export interface EncryptedBlobEnvelope {
  chunkCount: number;
  chunkSize: number;
  cipher: EncryptedBlobStoreCipher;
  format: typeof ENCRYPTED_BLOB_STORE_FORMAT;
  iv: string;
  keyDerivation: KeyDerivationEnvelope | null;
  plaintextByteLength: number;
  version: typeof ENCRYPTED_BLOB_STORE_VERSION;
}

export interface ParsedEncryptedBlobEnvelope {
  encryptedByteLength: number;
  envelope: EncryptedBlobEnvelope;
  headerBytes: BlobBytes;
  iv: BlobBytes;
  prefixByteLength: number;
}

export const ENCRYPTED_BLOB_STORE_FORMAT =
  "symcrypt.local-blob-store.encrypted";
export const ENCRYPTED_BLOB_STORE_VERSION = 2;
export const ENCRYPTED_BLOB_CHUNK_SIZE = 5 * 1024 * 1024;
export const AES_GCM_TAG_BYTES = 16;

const AES_GCM_IV_BYTES = 12;
const DEFAULT_KDF_ITERATIONS = 310_000;
const MAX_HEADER_BYTES = 64 * 1024;
const MAGIC_BYTES = new TextEncoder().encode(
  "symcrypt.local-blob-store.encrypted.v2",
);
const HEADER_LENGTH_BYTES = 4;
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const TEXT_ENCODER = new TextEncoder();

export function asBlobBytes(bytes: Uint8Array): BlobBytes {
  if (!(bytes.buffer instanceof ArrayBuffer)) {
    throw new Error("Encrypted blob store bytes must be ArrayBuffer-backed.");
  }
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

export function readBase64Bytes(
  value: Record<string, unknown>,
  key: string,
  label: string,
): BlobBytes {
  const encoded = readRecordString(value, key, label);
  try {
    return asBlobBytes(base64ToBytes(encoded));
  } catch {
    throw new Error(`${label}.${key} must be base64.`);
  }
}

export function normalizeCipher(
  cipher: string | undefined,
): EncryptedBlobStoreCipher {
  if (cipher === undefined || cipher === "aes-256-gcm") {
    return "aes-256-gcm";
  }
  throw new Error(`Unsupported encrypted blob store cipher: ${cipher}`);
}

export function normalizeKdfIterations(iterations: number | undefined): number {
  if (iterations === undefined) {
    return DEFAULT_KDF_ITERATIONS;
  }
  if (!Number.isSafeInteger(iterations) || iterations <= 0) {
    throw new Error(
      "Encrypted blob store KDF iterations must be a positive integer.",
    );
  }
  return iterations;
}

export function assertNamespace(namespace: string): void {
  if (namespace.length === 0) {
    throw new Error("Encrypted blob store namespace must be non-empty.");
  }
}

export function createAesGcmIv(): BlobBytes {
  return crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
}

export function createKeyDerivationEnvelope(input: {
  cipher: EncryptedBlobStoreCipher;
  iterations: number;
  namespace: string;
}): KeyDerivationEnvelope {
  const salt = TEXT_ENCODER.encode(
    `symcrypt.local-opfs-blob-store.v2.${input.cipher}.${input.namespace}`,
  );
  return {
    name: "pbkdf2-sha256",
    iterations: input.iterations,
    salt: bytesToBase64(salt),
  };
}

function readKeyDerivationEnvelope(
  value: unknown,
): KeyDerivationEnvelope | null {
  if (value === null || value === undefined) {
    return null;
  }
  const record = readRecord(value, "Encrypted blob store keyDerivation");
  if (
    readRecordString(record, "name", "Encrypted blob store keyDerivation") !==
    "pbkdf2-sha256"
  ) {
    throw new Error("Encrypted blob store key derivation is unsupported.");
  }
  if (
    readBase64Bytes(record, "salt", "Encrypted blob store keyDerivation")
      .byteLength === 0
  ) {
    throw new Error("Encrypted blob store key derivation salt is empty.");
  }
  return {
    name: "pbkdf2-sha256",
    iterations: readRecordSafePositiveInteger(
      record,
      "iterations",
      "Encrypted blob store keyDerivation",
    ),
    salt: readRecordString(
      record,
      "salt",
      "Encrypted blob store keyDerivation",
    ),
  };
}

function parseHeader(headerBytes: BlobBytes): {
  envelope: EncryptedBlobEnvelope;
  iv: BlobBytes;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(TEXT_DECODER.decode(headerBytes));
  } catch {
    throw new Error("Encrypted blob store header is invalid JSON.");
  }
  const label = "Encrypted blob store header";
  const record = readRecord(parsed, label);
  if (
    readRecordString(record, "format", label) !== ENCRYPTED_BLOB_STORE_FORMAT
  ) {
    throw new Error("Encrypted blob store payload format is invalid.");
  }
  if (readRecordSafePositiveInteger(record, "version", label) !== 2) {
    throw new Error("Encrypted blob store payload version is invalid.");
  }
  const chunkSize = readRecordSafePositiveInteger(record, "chunkSize", label);
  if (chunkSize !== ENCRYPTED_BLOB_CHUNK_SIZE) {
    throw new Error("Encrypted blob store payload chunk size is invalid.");
  }
  const plaintextByteLength = readRecordSafeByteLength(
    record,
    "plaintextByteLength",
    label,
  );
  const chunkCount = readRecordSafePositiveInteger(record, "chunkCount", label);
  if (chunkCount !== getChunkCount(plaintextByteLength)) {
    throw new Error("Encrypted blob store payload chunk count is invalid.");
  }
  const iv = readBase64Bytes(record, "iv", label);
  if (iv.byteLength !== AES_GCM_IV_BYTES) {
    throw new Error("Encrypted blob store payload IV is invalid.");
  }
  const { keyDerivation } = record;
  return {
    envelope: {
      chunkCount,
      chunkSize,
      cipher: normalizeCipher(readRecordString(record, "cipher", label)),
      format: ENCRYPTED_BLOB_STORE_FORMAT,
      iv: readRecordString(record, "iv", label),
      keyDerivation: readKeyDerivationEnvelope(keyDerivation),
      plaintextByteLength,
      version: ENCRYPTED_BLOB_STORE_VERSION,
    },
    iv,
  };
}

export function getChunkCount(plaintextByteLength: number): number {
  if (!Number.isSafeInteger(plaintextByteLength) || plaintextByteLength < 0) {
    throw new Error("Encrypted blob store byte length is invalid.");
  }
  return Math.max(
    1,
    Math.ceil(plaintextByteLength / ENCRYPTED_BLOB_CHUNK_SIZE),
  );
}

export function getChunkPlaintextByteLength(
  plaintextByteLength: number,
  chunkIndex: number,
): number {
  const chunkCount = getChunkCount(plaintextByteLength);
  if (
    !Number.isSafeInteger(chunkIndex) ||
    chunkIndex < 0 ||
    chunkIndex >= chunkCount
  ) {
    throw new Error("Encrypted blob store chunk index is invalid.");
  }
  if (chunkIndex < chunkCount - 1) {
    return ENCRYPTED_BLOB_CHUNK_SIZE;
  }
  return plaintextByteLength - chunkIndex * ENCRYPTED_BLOB_CHUNK_SIZE;
}

export function serializeEncryptedBlobEnvelope(
  envelope: EncryptedBlobEnvelope,
): { headerBytes: BlobBytes; prefixBytes: BlobBytes } {
  const headerBytes = TEXT_ENCODER.encode(JSON.stringify(envelope));
  if (headerBytes.byteLength > MAX_HEADER_BYTES) {
    throw new Error("Encrypted blob store header is too large.");
  }
  const prefixBytes = new Uint8Array(
    MAGIC_BYTES.byteLength + HEADER_LENGTH_BYTES + headerBytes.byteLength,
  );
  prefixBytes.set(MAGIC_BYTES);
  new DataView(prefixBytes.buffer).setUint32(
    MAGIC_BYTES.byteLength,
    headerBytes.byteLength,
  );
  prefixBytes.set(headerBytes, MAGIC_BYTES.byteLength + HEADER_LENGTH_BYTES);
  return { headerBytes, prefixBytes };
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength && left.every((v, i) => v === right[i])
  );
}

export async function readEncryptedBlobEnvelope(
  source: BlobByteSource,
): Promise<ParsedEncryptedBlobEnvelope> {
  const fixedPrefixLength = MAGIC_BYTES.byteLength + HEADER_LENGTH_BYTES;
  if (source.byteLength < fixedPrefixLength) {
    throw new Error("Encrypted blob store payload is too short.");
  }
  const fixedPrefix = await readExactBlobBytes(source, 0, fixedPrefixLength);
  if (
    !equalBytes(fixedPrefix.subarray(0, MAGIC_BYTES.byteLength), MAGIC_BYTES)
  ) {
    throw new Error("Encrypted blob store payload format is invalid.");
  }
  const headerByteLength = new DataView(
    fixedPrefix.buffer,
    fixedPrefix.byteOffset,
    fixedPrefix.byteLength,
  ).getUint32(MAGIC_BYTES.byteLength);
  if (headerByteLength === 0 || headerByteLength > MAX_HEADER_BYTES) {
    throw new Error("Encrypted blob store header length is invalid.");
  }
  const prefixByteLength = fixedPrefixLength + headerByteLength;
  if (source.byteLength < prefixByteLength) {
    throw new Error("Encrypted blob store payload is truncated.");
  }
  const headerBytes = await readExactBlobBytes(
    source,
    fixedPrefixLength,
    headerByteLength,
  );
  const { envelope, iv } = parseHeader(headerBytes);
  const encryptedByteLength =
    prefixByteLength +
    envelope.plaintextByteLength +
    envelope.chunkCount * AES_GCM_TAG_BYTES;
  if (
    !Number.isSafeInteger(encryptedByteLength) ||
    source.byteLength !== encryptedByteLength
  ) {
    throw new Error("Encrypted blob store payload length is invalid.");
  }
  return {
    encryptedByteLength,
    envelope,
    headerBytes,
    iv,
    prefixByteLength,
  };
}

function writeLengthPrefixedText(
  target: Uint8Array,
  offset: number,
  value: string,
): number {
  const bytes = TEXT_ENCODER.encode(value);
  new DataView(target.buffer).setUint32(offset, bytes.byteLength);
  target.set(bytes, offset + 4);
  return offset + 4 + bytes.byteLength;
}

export function chunkAdditionalData(input: {
  chunkIndex: number;
  headerBytes: BlobBytes;
  namespace: string;
  storageKey: string;
}): BlobBytes {
  const namespaceBytes = TEXT_ENCODER.encode(input.namespace);
  const storageKeyBytes = TEXT_ENCODER.encode(input.storageKey);
  const bytes = new Uint8Array(
    4 +
      namespaceBytes.byteLength +
      4 +
      storageKeyBytes.byteLength +
      4 +
      input.headerBytes.byteLength,
  );
  let offset = writeLengthPrefixedText(bytes, 0, input.namespace);
  offset = writeLengthPrefixedText(bytes, offset, input.storageKey);
  new DataView(bytes.buffer).setUint32(offset, input.chunkIndex);
  bytes.set(input.headerBytes, offset + 4);
  return bytes;
}

export function deriveChunkIv(
  baseIv: BlobBytes,
  chunkIndex: number,
): BlobBytes {
  if (
    !Number.isSafeInteger(chunkIndex) ||
    chunkIndex < 0 ||
    chunkIndex > 0xffff_ffff
  ) {
    throw new Error("Encrypted blob store chunk index exceeds the IV domain.");
  }
  const iv = baseIv.slice();
  const view = new DataView(iv.buffer, iv.byteOffset, iv.byteLength);
  view.setUint32(8, view.getUint32(8) ^ chunkIndex);
  return iv;
}
