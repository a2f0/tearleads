import { createMemoryBlobStore } from "./memoryBlobStore";
import { createOpfsBlobStore, isOpfsBlobStoreSupported } from "./opfsBlobStore";
import type { BlobStore } from "./types";

const memoryStoreByNamespace = new Map<string, BlobStore>();
const opfsStoreByNamespace = new Map<string, BlobStore>();

export function createBlobStore(namespace: string): BlobStore {
  if (isOpfsBlobStoreSupported()) {
    const existingOpfsStore = opfsStoreByNamespace.get(namespace);
    if (existingOpfsStore) {
      return existingOpfsStore;
    }

    const nextOpfsStore = createOpfsBlobStore(namespace);
    opfsStoreByNamespace.set(namespace, nextOpfsStore);
    return nextOpfsStore;
  }

  const existingMemoryStore = memoryStoreByNamespace.get(namespace);
  if (existingMemoryStore) {
    return existingMemoryStore;
  }

  const nextMemoryStore = createMemoryBlobStore();
  memoryStoreByNamespace.set(namespace, nextMemoryStore);
  return nextMemoryStore;
}
