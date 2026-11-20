import {
  type BlobByteSource,
  type BlobBytes,
  type BlobStore,
  createBlobByteSource,
  readBlobByteSource,
} from "./blobContracts";

class MemoryBlobStore implements BlobStore {
  private readonly bytesByKey = new Map<string, BlobBytes>();

  async deleteBytes(storageKey: string, assertCurrent?: () => void) {
    assertCurrent?.();
    this.bytesByKey.delete(storageKey);
  }

  async openByteSource(storageKey: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const bytes = this.bytesByKey.get(storageKey);
    return bytes ? createBlobByteSource(bytes) : null;
  }

  async readBytes(storageKey: string) {
    const source = await this.openByteSource(storageKey);
    return source ? readBlobByteSource(source) : null;
  }

  async writeByteSource(
    storageKey: string,
    source: BlobByteSource,
    assertCurrent?: () => void,
  ) {
    const bytes = await readBlobByteSource(source);
    assertCurrent?.();
    this.bytesByKey.set(storageKey, bytes);
  }

  async writeBytes(
    storageKey: string,
    bytes: BlobBytes,
    assertCurrent?: () => void,
  ) {
    await this.writeByteSource(
      storageKey,
      createBlobByteSource(bytes),
      assertCurrent,
    );
  }
}

export function createMemoryBlobStore(): BlobStore {
  return new MemoryBlobStore();
}
