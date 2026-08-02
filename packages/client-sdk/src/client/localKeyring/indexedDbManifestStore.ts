import { IndexedDbStoreConnection } from "../indexedDbStoreConnection";
import {
  parseLocalKeyringManifest,
  serializeLocalKeyringManifest,
} from "./manifest";
import { assertNonEmptyString } from "./primitives";
import { localKeyringScopeKey } from "./scope";
import type {
  LocalKeyringManifest,
  LocalKeyringManifestStore,
  LocalKeyringScope,
} from "./types";

/**
 * IndexedDB database/store holding one manifest record per keyring scope, kept
 * separate from the wrapping-key database so the two never coordinate versions.
 */
const BROWSER_KEYRING_MANIFEST_DATABASE_NAME =
  "tearleads-local-keyring-manifests";
const BROWSER_KEYRING_MANIFEST_STORE_NAME = "manifests";

export interface IndexedDbLocalKeyringManifestStoreOptions {
  readonly databaseName?: string | undefined;
  readonly indexedDB?: IDBFactory | undefined;
  readonly objectStoreName?: string | undefined;
}

export function isIndexedDbAvailable(): boolean {
  // Require a usable factory, not merely a defined global: test environments stub
  // `indexedDB` with a non-functional placeholder, and a real persistent database
  // (which needs a working IndexedDB anyway) is the only place this store runs.
  return (
    typeof globalThis.indexedDB === "object" &&
    globalThis.indexedDB !== null &&
    typeof globalThis.indexedDB.open === "function"
  );
}

function getDefaultIndexedDb(): IDBFactory {
  if (!isIndexedDbAvailable()) {
    throw new Error(
      "Browser local keyring manifest storage requires IndexedDB.",
    );
  }
  return globalThis.indexedDB;
}

function readManifestRecordValue(record: unknown): string | null {
  if (typeof record !== "object" || record === null) {
    return null;
  }
  const manifest = Reflect.get(record, "manifest");
  return typeof manifest === "string" ? manifest : null;
}

/**
 * Persists keyring manifests in IndexedDB, where the wrapping key already lives.
 * The point is shared eviction fate: the manifest holds the wrapped root key that
 * derives the database's cipher key, so storing it in localStorage (evicted far
 * more aggressively — e.g. Safari ITP's script-writable-storage cap) lets the
 * keyring be lost while the OPFS-persisted, encrypted database survives, minting a
 * fresh root on the next boot and yielding SQLITE_NOTADB. IndexedDB shares the
 * origin's storage bucket with OPFS, so the manifest and database are evicted
 * together (a clean reset) or survive together — and unlike main-thread OPFS file
 * writes (unsupported on WebKit), IndexedDB works in every context the keyring
 * runs in.
 */
class IndexedDbLocalKeyringManifestStore implements LocalKeyringManifestStore {
  private readonly connection: IndexedDbStoreConnection;

  constructor(options: IndexedDbLocalKeyringManifestStoreOptions = {}) {
    const databaseName =
      options.databaseName ?? BROWSER_KEYRING_MANIFEST_DATABASE_NAME;
    const objectStoreName =
      options.objectStoreName ?? BROWSER_KEYRING_MANIFEST_STORE_NAME;
    assertNonEmptyString(databaseName, "IndexedDB database name");
    assertNonEmptyString(objectStoreName, "IndexedDB object store name");
    this.connection = new IndexedDbStoreConnection({
      databaseName,
      indexedDB: options.indexedDB ?? getDefaultIndexedDb(),
      keyPath: "scopeKey",
      objectStoreName,
    });
  }

  close(): void {
    this.connection.close();
  }

  async deleteManifest(scope: LocalKeyringScope): Promise<void> {
    await this.write((store) => store.delete(localKeyringScopeKey(scope)));
  }

  async loadManifest(
    scope: LocalKeyringScope,
  ): Promise<LocalKeyringManifest | null> {
    const record = await this.read(localKeyringScopeKey(scope));
    const serialized = readManifestRecordValue(record);
    return serialized ? parseLocalKeyringManifest(serialized) : null;
  }

  async saveManifest(manifest: LocalKeyringManifest): Promise<void> {
    await this.write((store) =>
      store.put({
        scopeKey: localKeyringScopeKey(manifest.scope),
        manifest: serializeLocalKeyringManifest(manifest),
      }),
    );
  }

  private async read(scopeKey: string): Promise<unknown> {
    return this.connection.request("readonly", (store) => store.get(scopeKey));
  }

  private async write<T>(
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return this.connection.request("readwrite", operation);
  }
}

export function createIndexedDbLocalKeyringManifestStore(
  options: IndexedDbLocalKeyringManifestStoreOptions = {},
): LocalKeyringManifestStore {
  return new IndexedDbLocalKeyringManifestStore(options);
}
