import {
  parseLocalKeyringManifest,
  serializeLocalKeyringManifest,
} from "./manifest";
import { localKeyringScopeKey } from "./scope";
import type {
  LocalKeyringManifest,
  LocalKeyringManifestStorage,
  LocalKeyringManifestStore,
  LocalKeyringScope,
} from "./types";

const LOCAL_STORAGE_MANIFEST_PREFIX = "symcrypt.local-keyring.manifest:";

export interface LocalStorageLocalKeyringManifestStoreOptions {
  readonly prefix?: string | undefined;
  readonly storage?: LocalKeyringManifestStorage | undefined;
}

function getDefaultLocalKeyringManifestStorage(): LocalKeyringManifestStorage {
  if (typeof globalThis.localStorage === "undefined") {
    throw new Error("Browser local keyring manifest storage is unavailable.");
  }

  return globalThis.localStorage;
}

class LocalStorageLocalKeyringManifestStore
  implements LocalKeyringManifestStore
{
  private readonly prefix: string;
  private readonly storage: LocalKeyringManifestStorage;

  constructor(
    options: LocalStorageLocalKeyringManifestStoreOptions | undefined,
  ) {
    this.prefix = options?.prefix ?? LOCAL_STORAGE_MANIFEST_PREFIX;
    this.storage = options?.storage ?? getDefaultLocalKeyringManifestStorage();
  }

  async deleteManifest(scope: LocalKeyringScope): Promise<void> {
    this.storage.removeItem(this.storageKey(scope));
  }

  async loadManifest(
    scope: LocalKeyringScope,
  ): Promise<LocalKeyringManifest | null> {
    const serialized = this.storage.getItem(this.storageKey(scope));
    return serialized ? parseLocalKeyringManifest(serialized) : null;
  }

  async saveManifest(manifest: LocalKeyringManifest): Promise<void> {
    this.storage.setItem(
      this.storageKey(manifest.scope),
      serializeLocalKeyringManifest(manifest),
    );
  }

  private storageKey(scope: LocalKeyringScope): string {
    return `${this.prefix}${localKeyringScopeKey(scope)}`;
  }
}

export function createLocalStorageLocalKeyringManifestStore(
  options: LocalStorageLocalKeyringManifestStoreOptions = {},
): LocalKeyringManifestStore {
  return new LocalStorageLocalKeyringManifestStore(options);
}
