import type { BlobBytes, BlobStore } from "../blobContracts";

class MemoryBlobStore implements BlobStore {
  private readonly bytesByKey = new Map<string, BlobBytes>();

  async deleteBytes(storageKey: string) {
    this.bytesByKey.delete(storageKey);
  }

  async readBytes(storageKey: string) {
    const bytes = this.bytesByKey.get(storageKey);
    return bytes ? bytes.slice() : null;
  }

  async writeBytes(storageKey: string, bytes: BlobBytes) {
    this.bytesByKey.set(storageKey, bytes.slice());
  }
}

export function createMemoryBlobStore(): BlobStore {
  return new MemoryBlobStore();
}
