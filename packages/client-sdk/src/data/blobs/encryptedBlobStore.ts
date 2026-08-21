import { bytesToBase64 } from "@symcrypt/encoding";
import {
  type BlobByteSource,
  type BlobBytes,
  type BlobStore,
  createBlobByteSource,
  readBlobByteSource,
} from "../blobContracts";
import {
  createDecryptedBlobByteSource,
  createEncryptedBlobByteSource,
} from "./encryptedBlobByteSource";
import {
  asBlobBytes,
  assertNamespace,
  createAesGcmIv,
  createKeyDerivationEnvelope,
  ENCRYPTED_BLOB_CHUNK_SIZE,
  ENCRYPTED_BLOB_STORE_FORMAT,
  ENCRYPTED_BLOB_STORE_VERSION,
  type EncryptedBlobEnvelope,
  type EncryptedBlobStoreCipher,
  getChunkCount,
  type KeyDerivationEnvelope,
  normalizeCipher,
  normalizeKdfIterations,
  readBase64Bytes,
  readEncryptedBlobEnvelope,
  serializeEncryptedBlobEnvelope,
} from "./encryptedBlobEnvelope";
import { createOpfsBlobStore, isOpfsBlobStoreSupported } from "./opfsBlobStore";

export type { EncryptedBlobStoreCipher };
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

const AES_256_KEY_BYTES = 32;
const TEXT_ENCODER = new TextEncoder();

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

  async openByteSource(storageKey: string): Promise<BlobByteSource | null> {
    const encryptedSource = await this.innerStore.openByteSource(storageKey);
    if (!encryptedSource) {
      return null;
    }

    const parsed = await readEncryptedBlobEnvelope(encryptedSource);
    const key = await this.getCipherKey(parsed.envelope.keyDerivation);
    return createDecryptedBlobByteSource({
      encryptedSource,
      headerBytes: parsed.headerBytes,
      iv: parsed.iv,
      key,
      namespace: this.namespace,
      parsed,
      storageKey,
    });
  }

  async readBytes(storageKey: string): Promise<BlobBytes | null> {
    const source = await this.openByteSource(storageKey);
    return source ? readBlobByteSource(source) : null;
  }

  async writeByteSource(
    storageKey: string,
    source: BlobByteSource,
  ): Promise<void> {
    const keyDerivation = this.createKeyDerivationEnvelope();
    const key = await this.getCipherKey(keyDerivation);
    const iv = createAesGcmIv();
    const envelope: EncryptedBlobEnvelope = {
      chunkCount: getChunkCount(source.byteLength),
      chunkSize: ENCRYPTED_BLOB_CHUNK_SIZE,
      cipher: this.cipher,
      format: ENCRYPTED_BLOB_STORE_FORMAT,
      iv: bytesToBase64(iv),
      keyDerivation,
      plaintextByteLength: source.byteLength,
      version: ENCRYPTED_BLOB_STORE_VERSION,
    };
    const { headerBytes, prefixBytes } =
      serializeEncryptedBlobEnvelope(envelope);
    await this.innerStore.writeByteSource(
      storageKey,
      createEncryptedBlobByteSource({
        envelope,
        headerBytes,
        iv,
        key,
        namespace: this.namespace,
        plaintextSource: source,
        prefixBytes,
        storageKey,
      }),
    );
  }

  async writeBytes(storageKey: string, bytes: BlobBytes): Promise<void> {
    await this.writeByteSource(storageKey, createBlobByteSource(bytes));
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

export function createEncryptedBlobStore(
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

export function createLazyEncryptedBlobStore(
  namespace: string,
  keyProvider: () => Promise<EncryptedBlobStoreKey>,
): BlobStore {
  let innerStorePromise: Promise<BlobStore> | null = null;

  function getStore(): Promise<BlobStore> {
    if (!innerStorePromise) {
      innerStorePromise = (async () => {
        try {
          const key = await keyProvider();
          return createEncryptedBlobStore(namespace, { key });
        } catch (error) {
          innerStorePromise = null;
          throw error;
        }
      })();
    }

    return innerStorePromise;
  }

  return {
    deleteBytes: async (storageKey) => {
      const store = await getStore();
      return store.deleteBytes(storageKey);
    },
    openByteSource: async (storageKey) => {
      const store = await getStore();
      return store.openByteSource(storageKey);
    },
    readBytes: async (storageKey) => {
      const store = await getStore();
      return store.readBytes(storageKey);
    },
    writeByteSource: async (storageKey, source) => {
      const store = await getStore();
      return store.writeByteSource(storageKey, source);
    },
    writeBytes: async (storageKey, bytes) => {
      const store = await getStore();
      return store.writeBytes(storageKey, bytes);
    },
  };
}
