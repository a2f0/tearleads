import type { BlobStore } from "./types";

class MemoryBlobStore implements BlobStore {
  private readonly bytesByKey = new Map<string, Uint8Array>();

  async deleteBytes(storageKey: string) {
    this.bytesByKey.delete(storageKey);
  }

  async readBytes(storageKey: string) {
    const bytes = this.bytesByKey.get(storageKey);
    return bytes ? bytes.slice() : null;
  }

  async writeBytes(storageKey: string, bytes: Uint8Array) {
    this.bytesByKey.set(storageKey, bytes.slice());
  }
}

export function createMemoryBlobStore(): BlobStore {
  return new MemoryBlobStore();
}
