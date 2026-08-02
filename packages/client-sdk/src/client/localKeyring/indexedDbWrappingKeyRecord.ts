import { readObject, readString } from "./jsonReaders";
import { copyBytes } from "./primitives";
import type { WrappingKeyMaterialStorage } from "./types";

const WRAPPING_KEY_BYTES = 32;

export interface IndexedDbWrappingKeyRecord {
  readonly createdAt: string;
  // Exactly one of `key` / `keyMaterial` is set, per the keystore's
  // keyMaterialStorage mode. `key` holds a live non-extractable CryptoKey;
  // `keyMaterial` holds exported raw AES-GCM bytes for WebView shells that
  // cannot structured-clone a CryptoKey (see WrappingKeyMaterialStorage).
  readonly key?: CryptoKey;
  readonly keyId: string;
  readonly keyMaterial?: Uint8Array;
  readonly provider: string;
}

export function hasErrorName(error: unknown, expectedName: string): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  if (
    "name" in error &&
    typeof error.name === "string" &&
    error.name === expectedName
  ) {
    return true;
  }
  if ("cause" in error) {
    return hasErrorName(error.cause, expectedName);
  }

  return false;
}

function isCryptoKey(value: unknown): value is CryptoKey {
  return typeof CryptoKey !== "undefined" && value instanceof CryptoKey;
}

export function assertAesGcmWrappingCryptoKey(key: CryptoKey): void {
  const algorithm = key.algorithm;
  const algorithmLength =
    "length" in algorithm && typeof algorithm.length === "number"
      ? algorithm.length
      : null;
  if (
    key.type !== "secret" ||
    key.extractable ||
    algorithm.name !== "AES-GCM" ||
    algorithmLength !== 256 ||
    !key.usages.includes("decrypt") ||
    !key.usages.includes("encrypt")
  ) {
    throw new Error(
      "IndexedDB wrapping key must be a non-extractable AES-GCM secret key.",
    );
  }
}

export function readWrappingKeyMaterial(value: unknown): Uint8Array {
  const bytes =
    value instanceof Uint8Array
      ? value
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : null;
  if (!bytes || bytes.byteLength !== WRAPPING_KEY_BYTES) {
    throw new Error(
      "IndexedDB wrapping key material must be 32 raw AES-256 bytes.",
    );
  }
  return bytes;
}

// Re-import the persisted raw bytes as a non-extractable runtime key: the bytes
// at rest are extractable (that is the cost of the "raw-bytes" mode), but the
// in-memory CryptoKey handed to encrypt/decrypt stays non-extractable. The
// temporary copy is wiped once WebCrypto has imported it so the raw key material
// does not linger in memory.
export async function importRawWrappingKey(
  keyMaterial: Uint8Array,
): Promise<CryptoKey> {
  const keyBytes = copyBytes(keyMaterial);
  try {
    return await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { length: 256, name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    keyBytes.fill(0);
  }
}

export function readIndexedDbWrappingKeyRecord(input: {
  readonly keyId: string;
  readonly keyMaterialStorage: WrappingKeyMaterialStorage;
  readonly provider: string;
  readonly value: unknown;
}): IndexedDbWrappingKeyRecord {
  const record = readObject(input.value, "IndexedDB wrapping key record");
  const keyId = readString(record, "keyId");
  if (keyId !== input.keyId) {
    throw new Error("IndexedDB wrapping key id does not match.");
  }
  const provider = readString(record, "provider");
  if (provider !== input.provider) {
    throw new Error("IndexedDB wrapping key provider does not match.");
  }
  const createdAt = readString(record, "createdAt");
  if (input.keyMaterialStorage === "raw-bytes") {
    const keyMaterial = record.get("keyMaterial");
    if (keyMaterial === undefined) {
      throw new Error(
        "IndexedDB wrapping key record is missing its raw key material.",
      );
    }
    return {
      createdAt,
      keyId,
      keyMaterial: readWrappingKeyMaterial(keyMaterial),
      provider,
    };
  }
  const key = record.get("key");
  if (!isCryptoKey(key)) {
    throw new Error("IndexedDB wrapping key record is missing its CryptoKey.");
  }
  assertAesGcmWrappingCryptoKey(key);

  return { createdAt, key, keyId, provider };
}
