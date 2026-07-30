import {
  type BlobStore,
  createBlobByteSource,
  readBlobByteSource,
} from "@tearleads/client-sdk";

type FixtureBlobBytes = Parameters<BlobStore["writeBytes"]>[1];

export function createFixtureBlobStore(): BlobStore {
  const blobs = new Map<string, FixtureBlobBytes>();

  return {
    async deleteBytes(storageKey) {
      blobs.delete(storageKey);
    },
    async readBytes(storageKey) {
      return blobs.get(storageKey) ?? null;
    },
    async openByteSource(storageKey) {
      const bytes = blobs.get(storageKey);
      return bytes ? createBlobByteSource(bytes) : null;
    },
    async writeByteSource(storageKey, source) {
      blobs.set(storageKey, await readBlobByteSource(source));
    },
    async writeBytes(storageKey, bytes) {
      blobs.set(storageKey, bytes);
    },
  };
}
