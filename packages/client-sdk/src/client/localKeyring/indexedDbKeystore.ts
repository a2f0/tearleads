import { unwrapAesGcmSecret, wrapAesGcmSecret } from "./aesGcmWrapping";
import { IndexedDbStoreConnection } from "./indexedDbStoreConnection";
import {
  assertAesGcmWrappingCryptoKey,
  hasErrorName,
  type IndexedDbWrappingKeyRecord,
  importRawWrappingKey,
  readIndexedDbWrappingKeyRecord,
  readWrappingKeyMaterial,
} from "./indexedDbWrappingKeyRecord";
import { assertNonEmptyString } from "./primitives";
import { localWrappingKeyScopeHash, normalizeLocalKeyringScope } from "./scope";
import type {
  LocalKeyringScope,
  UnwrapLocalSecretInput,
  WrapLocalSecretInput,
  WrappedLocalSecretEnvelope,
  WrappingKeyHandle,
  WrappingKeyKeystore,
  WrappingKeyMaterialStorage,
} from "./types";

const DEFAULT_WRAPPING_KEY_MATERIAL_STORAGE: WrappingKeyMaterialStorage =
  "crypto-key";
const BROWSER_INDEXED_DB_PROVIDER = "browser-indexeddb";
const BROWSER_KEYRING_DATABASE_NAME = "symcrypt-local-keyring";
const BROWSER_WRAPPING_KEYS_STORE_NAME = "wrappingKeys";

export interface IndexedDbWrappingKeyKeystoreOptions {
  readonly databaseName?: string | undefined;
  readonly indexedDB?: IDBFactory | undefined;
  readonly keyMaterialStorage?: WrappingKeyMaterialStorage | undefined;
  readonly objectStoreName?: string | undefined;
  readonly provider?: string | undefined;
}

function getDefaultIndexedDbFactory(): IDBFactory {
  if (typeof globalThis.indexedDB === "undefined") {
    throw new Error("Browser local keyring IndexedDB is unavailable.");
  }

  return globalThis.indexedDB;
}

class IndexedDbWrappingKeyKeystore implements WrappingKeyKeystore {
  readonly provider: string;
  private readonly connection: IndexedDbStoreConnection;
  private readonly keyMaterialStorage: WrappingKeyMaterialStorage;

  constructor(options: IndexedDbWrappingKeyKeystoreOptions | undefined) {
    const databaseName = options?.databaseName ?? BROWSER_KEYRING_DATABASE_NAME;
    this.keyMaterialStorage =
      options?.keyMaterialStorage ?? DEFAULT_WRAPPING_KEY_MATERIAL_STORAGE;
    const objectStoreName =
      options?.objectStoreName ?? BROWSER_WRAPPING_KEYS_STORE_NAME;
    this.provider = options?.provider ?? BROWSER_INDEXED_DB_PROVIDER;

    assertNonEmptyString(databaseName, "IndexedDB database name");
    assertNonEmptyString(objectStoreName, "IndexedDB object store name");
    assertNonEmptyString(this.provider, "IndexedDB wrapping key provider");
    this.connection = new IndexedDbStoreConnection({
      databaseName,
      indexedDB: options?.indexedDB ?? getDefaultIndexedDbFactory(),
      keyPath: "keyId",
      objectStoreName,
    });
  }

  close(): void {
    this.connection.close();
  }

  async deleteWrappingKey(scope: LocalKeyringScope): Promise<void> {
    await this.deleteStoredKey(await this.wrappingKeyId(scope));
  }

  async getOrCreateWrappingKey(
    scope: LocalKeyringScope,
  ): Promise<WrappingKeyHandle> {
    const keyId = await this.wrappingKeyId(scope);
    const existingKey = await this.loadStoredKey(keyId);
    if (existingKey) {
      return { keyId, provider: this.provider };
    }

    const record: IndexedDbWrappingKeyRecord = {
      createdAt: new Date().toISOString(),
      keyId,
      provider: this.provider,
      ...(await this.createWrappingKeyMaterial()),
    };
    try {
      await this.addStoredKey(record);
    } catch (error) {
      if (!hasErrorName(error, "ConstraintError")) {
        throw error;
      }
      const racedKey = await this.loadStoredKey(keyId);
      if (!racedKey) {
        throw error;
      }
    } finally {
      // IndexedDB serializes the value when add() is called, so the freshly
      // generated raw key bytes can be wiped from memory once the write settles.
      record.keyMaterial?.fill(0);
    }

    return { keyId, provider: this.provider };
  }

  async unwrapSecret({
    context,
    envelope,
  }: UnwrapLocalSecretInput): Promise<Uint8Array<ArrayBuffer>> {
    return unwrapAesGcmSecret({
      context,
      envelope,
      provider: this.provider,
      resolveKey: (keyId) => this.loadStoredKey(keyId),
    });
  }

  async wrapSecret({
    context,
    handle,
    plaintext,
  }: WrapLocalSecretInput): Promise<WrappedLocalSecretEnvelope> {
    return wrapAesGcmSecret({
      context,
      handle,
      plaintext,
      provider: this.provider,
      resolveKey: (keyId) => this.loadStoredKey(keyId),
    });
  }

  // Mints fresh wrapping-key material in whichever shape this keystore persists:
  // a live non-extractable CryptoKey ("crypto-key"), or exported raw AES-256
  // bytes ("raw-bytes") for WebView shells that cannot structured-clone a
  // CryptoKey into IndexedDB.
  private async createWrappingKeyMaterial(): Promise<
    Pick<IndexedDbWrappingKeyRecord, "key" | "keyMaterial">
  > {
    if (this.keyMaterialStorage === "raw-bytes") {
      const key = await crypto.subtle.generateKey(
        { length: 256, name: "AES-GCM" },
        true,
        ["encrypt", "decrypt"],
      );
      const keyMaterial = new Uint8Array(
        await crypto.subtle.exportKey("raw", key),
      );
      return { keyMaterial: readWrappingKeyMaterial(keyMaterial) };
    }

    const key = await crypto.subtle.generateKey(
      { length: 256, name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    assertAesGcmWrappingCryptoKey(key);
    return { key };
  }

  private addStoredKey(
    record: IndexedDbWrappingKeyRecord,
  ): Promise<IDBValidKey> {
    return this.writeStoredKey((store) => store.add(record));
  }

  private async deleteStoredKey(keyId: string): Promise<void> {
    await this.writeStoredKey((store) => store.delete(keyId));
  }

  private async loadStoredKey(keyId: string): Promise<CryptoKey | null> {
    const record = await this.readStoredKey(keyId);
    if (record === undefined) {
      return null;
    }

    const parsed = readIndexedDbWrappingKeyRecord({
      keyId,
      keyMaterialStorage: this.keyMaterialStorage,
      provider: this.provider,
      value: record,
    });
    if (parsed.key) {
      return parsed.key;
    }

    // Wipe the raw bytes read out of IndexedDB once they have been imported.
    const keyMaterial = readWrappingKeyMaterial(parsed.keyMaterial);
    try {
      return await importRawWrappingKey(keyMaterial);
    } finally {
      keyMaterial.fill(0);
    }
  }

  private async readStoredKey(keyId: string): Promise<unknown | undefined> {
    return this.connection.request("readonly", (store) => store.get(keyId));
  }

  private async writeStoredKey<T>(
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return this.connection.request("readwrite", operation);
  }

  private async wrappingKeyId(scope: LocalKeyringScope): Promise<string> {
    return `indexeddb:${await localWrappingKeyScopeHash(
      normalizeLocalKeyringScope(scope),
    )}`;
  }
}

export function createIndexedDbWrappingKeyKeystore(
  options: IndexedDbWrappingKeyKeystoreOptions = {},
): WrappingKeyKeystore {
  return new IndexedDbWrappingKeyKeystore(options);
}
