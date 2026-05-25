import type { BlobStore } from "../data/blobContracts";
import { createBlobStore } from "../data/blobs/createBlobStore";
import { createMemoryBlobStore } from "../data/blobs/memoryBlobStore";

export class Blobs {
  private readonly ephemeralStore = createMemoryBlobStore();
  private identityScoped = false;
  private storeValue: BlobStore;

  constructor(store?: BlobStore | undefined) {
    this.storeValue = store ?? this.ephemeralStore;
  }

  get store(): BlobStore {
    return this.storeValue;
  }

  setStore(store: BlobStore): void {
    this.identityScoped = false;
    this.storeValue = store;
  }

  useEphemeralStore(): void {
    this.identityScoped = false;
    this.storeValue = this.ephemeralStore;
  }

  useIdentityNamespace(signingFingerprint: string): void {
    this.identityScoped = true;
    this.storeValue = createBlobStore(signingFingerprint);
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
