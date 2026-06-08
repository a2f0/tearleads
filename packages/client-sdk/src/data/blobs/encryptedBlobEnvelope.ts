import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type { BlobBytes } from "../blobContracts";

export type EncryptedBlobStoreCipher = "aes-256-gcm";

export interface KeyDerivationEnvelope {
  name: "pbkdf2-sha256";
  iterations: number;
  salt: string;
}

export interface EncryptedBlobEnvelope {
  ciphertext: string;
  cipher: EncryptedBlobStoreCipher;
  format: typeof ENCRYPTED_BLOB_STORE_FORMAT;
  iv: string;
  keyDerivation: KeyDerivationEnvelope | null;
  version: 1;
}

interface ParsedEncryptedBlobEnvelope {
  ciphertext: Uint8Array<ArrayBuffer>;
  envelope: EncryptedBlobEnvelope;
  iv: Uint8Array<ArrayBuffer>;
}

export const ENCRYPTED_BLOB_STORE_FORMAT =
  "tearleads.local-blob-store.encrypted";
export const ENCRYPTED_BLOB_STORE_VERSION = 1;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const DEFAULT_KDF_ITERATIONS = 310_000;
const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

function isBlobBytes(bytes: Uint8Array): bytes is BlobBytes {
  return bytes.buffer instanceof ArrayBuffer;
}

export function asBlobBytes(bytes: Uint8Array): BlobBytes {
  if (!isBlobBytes(bytes)) {
    throw new Error("Encrypted blob store bytes must be ArrayBuffer-backed.");
  }

  return bytes;
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value;
}

function readString(
  value: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string.`);
  }

  return field;
}

function readNumber(
  value: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isInteger(field) || field <= 0) {
    throw new Error(`${label}.${key} must be a positive integer.`);
  }

  return field;
}

export function readBase64Bytes(
  value: Record<string, unknown>,
  key: string,
  label: string,
): Uint8Array<ArrayBuffer> {
  const encoded = readString(value, key, label);
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
  if (!Number.isInteger(iterations) || iterations <= 0) {
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

export function createAesGcmIv(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
}

function createPassphraseSalt(input: {
  cipher: EncryptedBlobStoreCipher;
  namespace: string;
}): Uint8Array<ArrayBuffer> {
  return TEXT_ENCODER.encode(
    `tearleads.local-opfs-blob-store.v1.${input.cipher}.${input.namespace}`,
  );
}

export function createKeyDerivationEnvelope(input: {
  cipher: EncryptedBlobStoreCipher;
  iterations: number;
  namespace: string;
}): KeyDerivationEnvelope {
  return {
    name: "pbkdf2-sha256",
    iterations: input.iterations,
    salt: bytesToBase64(createPassphraseSalt(input)),
  };
}

function readKeyDerivationEnvelope(
  value: unknown,
): KeyDerivationEnvelope | null {
  if (value === null) {
    return null;
  }
  const record = readRecord(value, "Encrypted blob store keyDerivation");
  if (
    readString(record, "name", "Encrypted blob store keyDerivation") !==
    "pbkdf2-sha256"
  ) {
    throw new Error("Encrypted blob store key derivation is unsupported.");
  }
  const salt = readBase64Bytes(
    record,
    "salt",
    "Encrypted blob store keyDerivation",
  );
  if (salt.byteLength === 0) {
    throw new Error("Encrypted blob store key derivation salt is empty.");
  }

  return {
    name: "pbkdf2-sha256",
    iterations: readNumber(
      record,
      "iterations",
      "Encrypted blob store keyDerivation",
    ),
    salt: readString(record, "salt", "Encrypted blob store keyDerivation"),
  };
}

function aadField(value: string | number): string {
  const stringValue = String(value);
  return `${stringValue.length}:${stringValue}`;
}

function keyDerivationAdditionalData(
  keyDerivation: KeyDerivationEnvelope | null,
): string {
  if (!keyDerivation) {
    return aadField("none");
  }

  return [
    aadField(keyDerivation.name),
    aadField(keyDerivation.iterations),
    aadField(keyDerivation.salt),
  ].join("");
}

export function envelopeAdditionalData(input: {
  envelope: EncryptedBlobEnvelope;
  namespace: string;
  storageKey: string;
}): Uint8Array<ArrayBuffer> {
  return TEXT_ENCODER.encode(
    [
      aadField(input.envelope.format),
      aadField(input.envelope.version),
      aadField(input.envelope.cipher),
      aadField(input.namespace),
      aadField(input.storageKey),
      aadField(input.envelope.iv),
      keyDerivationAdditionalData(input.envelope.keyDerivation),
    ].join(""),
  );
}

export function parseEncryptedBlobEnvelope(
  bytes: BlobBytes,
): ParsedEncryptedBlobEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(TEXT_DECODER.decode(bytes));
  } catch {
    throw new Error("Encrypted blob store payload is invalid JSON.");
  }

  const record = readRecord(parsed, "Encrypted blob store payload");
  if (
    readString(record, "format", "Encrypted blob store payload") !==
    ENCRYPTED_BLOB_STORE_FORMAT
  ) {
    throw new Error("Encrypted blob store payload format is invalid.");
  }
  if (
    readNumber(record, "version", "Encrypted blob store payload") !==
    ENCRYPTED_BLOB_STORE_VERSION
  ) {
    throw new Error("Encrypted blob store payload version is invalid.");
  }
  const cipher = normalizeCipher(
    readString(record, "cipher", "Encrypted blob store payload"),
  );
  const iv = readBase64Bytes(record, "iv", "Encrypted blob store payload");
  if (iv.byteLength !== AES_GCM_IV_BYTES) {
    throw new Error("Encrypted blob store payload IV is invalid.");
  }
  const ciphertext = readBase64Bytes(
    record,
    "ciphertext",
    "Encrypted blob store payload",
  );
  if (ciphertext.byteLength < AES_GCM_TAG_BYTES) {
    throw new Error("Encrypted blob store payload ciphertext is too short.");
  }
  const { keyDerivation } = record;

  return {
    ciphertext,
    envelope: {
      ciphertext: readString(
        record,
        "ciphertext",
        "Encrypted blob store payload",
      ),
      cipher,
      format: ENCRYPTED_BLOB_STORE_FORMAT,
      iv: readString(record, "iv", "Encrypted blob store payload"),
      keyDerivation: readKeyDerivationEnvelope(keyDerivation),
      version: ENCRYPTED_BLOB_STORE_VERSION,
    },
    iv,
  };
}
