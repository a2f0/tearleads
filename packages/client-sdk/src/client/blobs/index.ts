import type { BlobStore } from "../../data/blobs/blobContracts";
import { createBlobStore } from "../../data/blobs/createBlobStore";
import { createMemoryBlobStore } from "../../data/blobs/memoryBlobStore";

export type BlobStoreFactory = (namespace: string) => BlobStore;

export class Blobs {
  private readonly ephemeralStore = createMemoryBlobStore();
  private identityScoped = false;
  private readonly createIdentityStore: BlobStoreFactory;
  private storeValue: BlobStore;

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
    this.identityScoped = false;
    this.storeValue = this.ephemeralStore;
  }

  useIdentityNamespace(signingFingerprint: string): void {
    const store = this.createIdentityStore(signingFingerprint);
    this.identityScoped = true;
    this.storeValue = store;
  }

  updateIdentityNamespace(signingFingerprint: string | null): void {
    this.prepareIdentityChange(signingFingerprint)();
  }

  /** Prepare fallible storage before an identity change; commit only assigns state. */
  prepareIdentityChange(signingFingerprint: string | null): () => void {
    if (!this.identityScoped && this.storeValue !== this.ephemeralStore) {
      return () => undefined;
    }
    const store = signingFingerprint
      ? this.createIdentityStore(signingFingerprint)
      : this.ephemeralStore;
    return () => {
      this.identityScoped = signingFingerprint !== null;
      this.storeValue = store;
    };
  }
}
