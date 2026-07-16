import {
  type BlobByteSource,
  type BlobBytes,
  type BlobStore,
  createBlobByteSource,
  readBlobByteSource,
} from "../blobContracts";

class MemoryBlobStore implements BlobStore {
  private readonly bytesByKey = new Map<string, BlobBytes>();

  async deleteBytes(storageKey: string) {
    this.bytesByKey.delete(storageKey);
  }

  async openByteSource(storageKey: string) {
    const bytes = this.bytesByKey.get(storageKey);
    return bytes ? createBlobByteSource(bytes) : null;
  }

  async readBytes(storageKey: string) {
    const source = await this.openByteSource(storageKey);
    return source ? readBlobByteSource(source) : null;
  }

  async writeByteSource(storageKey: string, source: BlobByteSource) {
    this.bytesByKey.set(storageKey, await readBlobByteSource(source));
  }

  async writeBytes(storageKey: string, bytes: BlobBytes) {
    await this.writeByteSource(storageKey, createBlobByteSource(bytes));
  }
}

export function createMemoryBlobStore(): BlobStore {
  return new MemoryBlobStore();
}
