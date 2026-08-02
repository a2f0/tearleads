import { createIndexedDbWrappingKeyKeystore } from "./indexedDbKeystore";
import {
  createIndexedDbLocalKeyringManifestStore,
  isIndexedDbAvailable,
} from "./indexedDbManifestStore";
import { createLocalStorageLocalKeyringManifestStore } from "./localStorageManifestStore";
import { createLocalKeyring } from "./service";
import type {
  LocalKeyring,
  LocalKeyringManifestStorage,
  LocalKeyringManifestStore,
  WrappingKeyMaterialStorage,
} from "./types";

export interface BrowserLocalKeyringOptions {
  readonly databaseName?: string | undefined;
  readonly indexedDB?: IDBFactory | undefined;
  readonly keyMaterialStorage?: WrappingKeyMaterialStorage | undefined;
  /** Explicit manifest store; overrides the default IndexedDB/localStorage selection. */
  readonly manifestStore?: LocalKeyringManifestStore | undefined;
  /** localStorage-backed manifest storage (forces the localStorage store). */
  readonly manifestStorage?: LocalKeyringManifestStorage | undefined;
  readonly manifestStoragePrefix?: string | undefined;
  readonly objectStoreName?: string | undefined;
  readonly provider?: string | undefined;
  readonly now?: (() => Date) | undefined;
}

/**
 * Selects the manifest store for a browser keyring: IndexedDB when available (so
 * the manifest shares the OPFS-persisted database's eviction bucket — the fix for
 * the cipher-key/database desync that produced SQLITE_NOTADB — and lives where the
 * wrapping key already does), otherwise localStorage. Falling back to localStorage
 * is safe precisely where IndexedDB is absent: there is no persistent database to
 * desync from in that case.
 */
export function createBrowserLocalKeyringManifestStore(
  options: {
    readonly indexedDB?: IDBFactory | undefined;
    readonly prefix?: string | undefined;
    readonly storage?: LocalKeyringManifestStorage | undefined;
  } = {},
): LocalKeyringManifestStore {
  if (options.indexedDB || isIndexedDbAvailable()) {
    return createIndexedDbLocalKeyringManifestStore({
      indexedDB: options.indexedDB,
    });
  }
  return createLocalStorageLocalKeyringManifestStore({
    prefix: options.prefix,
    storage: options.storage,
  });
}

export function createBrowserLocalKeyring(
  options: BrowserLocalKeyringOptions = {},
): LocalKeyring {
  return createLocalKeyring({
    keystore: createIndexedDbWrappingKeyKeystore({
      databaseName: options.databaseName,
      indexedDB: options.indexedDB,
      keyMaterialStorage: options.keyMaterialStorage,
      objectStoreName: options.objectStoreName,
      provider: options.provider,
    }),
    manifestStore:
      options.manifestStore ??
      (options.manifestStorage
        ? createLocalStorageLocalKeyringManifestStore({
            prefix: options.manifestStoragePrefix,
            storage: options.manifestStorage,
          })
        : createBrowserLocalKeyringManifestStore({
            indexedDB: options.indexedDB,
            prefix: options.manifestStoragePrefix,
          })),
    now: options.now,
  });
}

/**
 * Browser local keyring tuned for WKWebView-based desktop/mobile shells
 * (Electrobun, Capacitor). Identical to {@link createBrowserLocalKeyring} except
 * the IndexedDB wrapping key is persisted as raw exported bytes instead of a live
 * CryptoKey object. WKWebView serializes a CryptoKey by writing a "WebCrypto
 * master key" to the macOS keychain, which fails with `errSecInteractionNotAllowed`
 * (-25308) in an unsigned app and aborts the IndexedDB write (and can crash the
 * WebContent process). Persisting raw bytes avoids the keychain entirely, at the
 * cost of an extractable wrapping key at rest — acceptable for a local shell whose
 * IndexedDB is already only reachable by the signed-in OS user.
 */
export function createWebViewLocalKeyring(
  options: BrowserLocalKeyringOptions = {},
): LocalKeyring {
  return createBrowserLocalKeyring({
    ...options,
    keyMaterialStorage: options.keyMaterialStorage ?? "raw-bytes",
  });
}
