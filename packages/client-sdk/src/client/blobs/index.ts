import type { BlobStore } from "../../data/blobs/blobContracts";
import { createBlobStore } from "../../data/blobs/createBlobStore";
import { createMemoryBlobStore } from "../../data/blobs/memoryBlobStore";
import type { PreparedIdentityChange } from "../identity";

export type BlobStoreFactory = (namespace: string) => BlobStore;

export class Blobs {
  private readonly ephemeralStore = createMemoryBlobStore();
  private identityScoped = false;
  private readonly createIdentityStore: BlobStoreFactory;
  private storeValue: BlobStore;
  // Only explicit host switches invalidate prepared identity storage.
  private revision = 0;

  constructor(
    store?: BlobStore | undefined,
    createIdentityStore: BlobStoreFactory = createBlobStore,
  ) {
    this.createIdentityStore = createIdentityStore;
    this.storeValue = store ?? this.ephemeralStore;
  }

  get store(): BlobStore {
    return this.storeValue;
  }

  useEphemeralStore(): void {
    this.revision += 1;
    this.identityScoped = false;
    this.storeValue = this.ephemeralStore;
  }

  useIdentityNamespace(signingFingerprint: string): void {
    const store = this.createIdentityStore(signingFingerprint);
    this.revision += 1;
    this.identityScoped = true;
    this.storeValue = store;
  }

  updateIdentityNamespace(signingFingerprint: string | null): void {
    const prepared = this.prepareIdentityChange(signingFingerprint);
    this.revision += 1;
    prepared.commit();
  }

  /** Prepare fallible storage before an identity change; commit only assigns state. */
  prepareIdentityChange(
    signingFingerprint: string | null,
  ): PreparedIdentityChange {
    const revision = this.revision;
    const isCurrent = () => this.revision === revision;
    if (!this.identityScoped && this.storeValue !== this.ephemeralStore) {
      return { isCurrent, commit: () => undefined };
    }
    const store = signingFingerprint
      ? this.createIdentityStore(signingFingerprint)
      : this.ephemeralStore;
    return {
      isCurrent,
      commit: () => {
        this.identityScoped = signingFingerprint !== null;
        this.storeValue = store;
      },
    };
  }
}
