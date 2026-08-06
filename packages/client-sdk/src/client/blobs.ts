import type { BlobStore } from "../data/blobContracts";
import { createBlobStore } from "../data/blobs/createBlobStore";
import { createMemoryBlobStore } from "../data/blobs/memoryBlobStore";

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
    this.identityScoped = true;
    this.storeValue = this.createIdentityStore(signingFingerprint);
  }

  updateIdentityNamespace(signingFingerprint: string | null): void {
    if (this.identityScoped || this.storeValue === this.ephemeralStore) {
      if (signingFingerprint) {
        this.useIdentityNamespace(signingFingerprint);
        return;
      }

      this.useEphemeralStore();
    }
  }
}
