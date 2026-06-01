import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type { BlobBytes, BlobStore } from "../blobContracts";
import { createMemoryBlobStore } from "./memoryBlobStore";
import { createOpfsBlobStore, isOpfsBlobStoreSupported } from "./opfsBlobStore";

export type EncryptedBlobStoreCipher = "aes-256-gcm";
export type EncryptedBlobStoreKey = string | Uint8Array | CryptoKey;

export interface EncryptedBlobStoreOptions {
  cipher?: EncryptedBlobStoreCipher | undefined;
  kdfIterations?: number | undefined;
  key: EncryptedBlobStoreKey;
}

export interface WrapEncryptedBlobStoreOptions
  extends EncryptedBlobStoreOptions {
  namespace: string;
}

interface KeyDerivationEnvelope {
  name: "pbkdf2-sha256";
  iterations: number;
  salt: string;
}

interface EncryptedBlobEnvelope {
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

const ENCRYPTED_BLOB_STORE_FORMAT = "tearleads.local-blob-store.encrypted";
const ENCRYPTED_BLOB_STORE_VERSION = 1;
const AES_256_KEY_BYTES = 32;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const DEFAULT_KDF_ITERATIONS = 310_000;
const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

function isBlobBytes(bytes: Uint8Array): bytes is BlobBytes {
  return bytes.buffer instanceof ArrayBuffer;
}

function asBlobBytes(bytes: Uint8Array): BlobBytes {
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

function readBase64Bytes(
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

function normalizeCipher(cipher: string | undefined): EncryptedBlobStoreCipher {
  if (cipher === undefined || cipher === "aes-256-gcm") {
    return "aes-256-gcm";
  }

  throw new Error(`Unsupported encrypted blob store cipher: ${cipher}`);
}

function normalizeKdfIterations(iterations: number | undefined): number {
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

function assertNamespace(namespace: string): void {
  if (namespace.length === 0) {
    throw new Error("Encrypted blob store namespace must be non-empty.");
  }
}

function isCryptoKey(value: unknown): value is CryptoKey {
  return typeof CryptoKey !== "undefined" && value instanceof CryptoKey;
}

function assertCryptoKey(key: CryptoKey): void {
  if (key.type !== "secret" || key.algorithm.name !== "AES-GCM") {
    throw new Error(
      "Encrypted blob store CryptoKey must be an AES-GCM secret.",
    );
  }
  if (!key.usages.includes("encrypt") || !key.usages.includes("decrypt")) {
    throw new Error(
      "Encrypted blob store CryptoKey must allow encrypt and decrypt.",
    );
  }
}

async function importRawAesKey(key: Uint8Array): Promise<CryptoKey> {
  if (key.byteLength !== AES_256_KEY_BYTES) {
    throw new Error("Encrypted blob store AES-256-GCM key must be 32 bytes.");
  }

  return crypto.subtle.importKey("raw", asBlobBytes(key), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function createAesGcmIv(): Uint8Array<ArrayBuffer> {
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

function createKeyDerivationEnvelope(input: {
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

function envelopeAdditionalData(input: {
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

function parseEncryptedBlobEnvelope(
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

class EncryptedBlobStore implements BlobStore {
  private readonly cipher: EncryptedBlobStoreCipher;
  private readonly derivedKeyByEnvelope = new Map<string, Promise<CryptoKey>>();
  private readonly kdfIterations: number;
  private readonly namespace: string;
  private readonly passphraseMaterialPromise: Promise<CryptoKey> | null;
  private readonly rawKeyPromise: Promise<CryptoKey> | null;

  constructor(
    private readonly innerStore: BlobStore,
    options: WrapEncryptedBlobStoreOptions,
  ) {
    if (!options || !("key" in options)) {
      throw new Error("Encrypted blob store key is required.");
    }
    assertNamespace(options.namespace);
    this.namespace = options.namespace;
    this.cipher = normalizeCipher(options.cipher);
    this.kdfIterations = normalizeKdfIterations(options.kdfIterations);

    if (typeof options.key === "string") {
      if (options.key.length === 0) {
        throw new Error("Encrypted blob store key must be non-empty.");
      }
      this.rawKeyPromise = null;
      this.passphraseMaterialPromise = crypto.subtle.importKey(
        "raw",
        TEXT_ENCODER.encode(options.key),
        "PBKDF2",
        false,
        ["deriveKey"],
      );
      return;
    }

    this.passphraseMaterialPromise = null;
    if (isCryptoKey(options.key)) {
      assertCryptoKey(options.key);
      this.rawKeyPromise = Promise.resolve(options.key);
      return;
    }

    if (!(options.key instanceof Uint8Array)) {
      throw new Error(
        "Encrypted blob store key must be a string, Uint8Array, or CryptoKey.",
      );
    }

    this.rawKeyPromise = importRawAesKey(options.key);
  }

  async deleteBytes(storageKey: string): Promise<void> {
    await this.innerStore.deleteBytes(storageKey);
  }

  async readBytes(storageKey: string): Promise<BlobBytes | null> {
    const encryptedBytes = await this.innerStore.readBytes(storageKey);
    if (!encryptedBytes) {
      return null;
    }

    const parsed = parseEncryptedBlobEnvelope(encryptedBytes);
    const key = await this.getCipherKey(parsed.envelope.keyDerivation);

    try {
      return asBlobBytes(
        new Uint8Array(
          await crypto.subtle.decrypt(
            {
              name: "AES-GCM",
              iv: parsed.iv,
              additionalData: envelopeAdditionalData({
                envelope: parsed.envelope,
                namespace: this.namespace,
                storageKey,
              }),
            },
            key,
            parsed.ciphertext,
          ),
        ),
      );
    } catch {
      throw new Error("Encrypted blob store payload could not be decrypted.");
    }
  }

  async writeBytes(storageKey: string, bytes: BlobBytes): Promise<void> {
    const keyDerivation = this.createKeyDerivationEnvelope();
    const key = await this.getCipherKey(keyDerivation);
    const iv = createAesGcmIv();
    const envelopeWithoutCiphertext: Omit<EncryptedBlobEnvelope, "ciphertext"> =
      {
        cipher: this.cipher,
        format: ENCRYPTED_BLOB_STORE_FORMAT,
        iv: bytesToBase64(iv),
        keyDerivation,
        version: ENCRYPTED_BLOB_STORE_VERSION,
      };
    const envelope = {
      ...envelopeWithoutCiphertext,
      ciphertext: "",
    };
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: envelopeAdditionalData({
            envelope,
            namespace: this.namespace,
            storageKey,
          }),
        },
        key,
        bytes,
      ),
    );

    await this.innerStore.writeBytes(
      storageKey,
      TEXT_ENCODER.encode(
        JSON.stringify({
          ...envelopeWithoutCiphertext,
          ciphertext: bytesToBase64(ciphertext),
        } satisfies EncryptedBlobEnvelope),
      ),
    );
  }

  private createKeyDerivationEnvelope(): KeyDerivationEnvelope | null {
    if (!this.passphraseMaterialPromise) {
      return null;
    }

    return createKeyDerivationEnvelope({
      cipher: this.cipher,
      iterations: this.kdfIterations,
      namespace: this.namespace,
    });
  }

  private async getCipherKey(
    keyDerivation: KeyDerivationEnvelope | null,
  ): Promise<CryptoKey> {
    if (!keyDerivation) {
      if (!this.rawKeyPromise) {
        throw new Error(
          "Encrypted blob store payload was not written with passphrase key derivation.",
        );
      }

      return this.rawKeyPromise;
    }

    if (!this.passphraseMaterialPromise) {
      throw new Error(
        "Encrypted blob store payload requires a passphrase key.",
      );
    }

    const cacheKey = JSON.stringify(keyDerivation);
    let derivedKeyPromise = this.derivedKeyByEnvelope.get(cacheKey);
    if (!derivedKeyPromise) {
      derivedKeyPromise = this.derivePassphraseKey(keyDerivation);
      derivedKeyPromise.catch(() => {
        if (this.derivedKeyByEnvelope.get(cacheKey) === derivedKeyPromise) {
          this.derivedKeyByEnvelope.delete(cacheKey);
        }
      });
      this.derivedKeyByEnvelope.set(cacheKey, derivedKeyPromise);
    }

    return derivedKeyPromise;
  }

  private async derivePassphraseKey(
    keyDerivation: KeyDerivationEnvelope,
  ): Promise<CryptoKey> {
    const passphraseMaterial = await this.passphraseMaterialPromise;
    if (!passphraseMaterial) {
      throw new Error("Encrypted blob store passphrase material is missing.");
    }

    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: keyDerivation.iterations,
        salt: readBase64Bytes(
          { salt: keyDerivation.salt },
          "salt",
          "Encrypted blob store keyDerivation",
        ),
      },
      passphraseMaterial,
      {
        name: "AES-GCM",
        length: 256,
      },
      false,
      ["encrypt", "decrypt"],
    );
  }
}

export function wrapEncryptedBlobStore(
  store: BlobStore,
  options: WrapEncryptedBlobStoreOptions,
): BlobStore {
  return new EncryptedBlobStore(store, options);
}

export function createEncryptedOpfsBlobStore(
  namespace: string,
  options: EncryptedBlobStoreOptions,
): BlobStore {
  if (!isOpfsBlobStoreSupported()) {
    throw new Error("OPFS blob store is not supported.");
  }

  return wrapEncryptedBlobStore(createOpfsBlobStore(namespace), {
    ...options,
    namespace,
  });
}

export function createEncryptedBlobStore(
  namespace: string,
  options: EncryptedBlobStoreOptions,
): BlobStore {
  const store = isOpfsBlobStoreSupported()
    ? createOpfsBlobStore(namespace)
    : createMemoryBlobStore();

  return wrapEncryptedBlobStore(store, { ...options, namespace });
}
