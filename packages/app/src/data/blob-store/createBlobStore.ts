import { createMemoryBlobStore } from "./memoryBlobStore";
import { createOpfsBlobStore, isOpfsBlobStoreSupported } from "./opfsBlobStore";
import type { BlobStore } from "./types";

const memoryStoreByNamespace = new Map<string, BlobStore>();
const opfsStoreByNamespace = new Map<string, BlobStore>();

export function createBlobStore(namespace: string | null): BlobStore {
  const normalizedNamespace = namespace ?? "anonymous";

  if (isOpfsBlobStoreSupported()) {
    const existingOpfsStore = opfsStoreByNamespace.get(normalizedNamespace);
    if (existingOpfsStore) {
      return existingOpfsStore;
    }

    const nextOpfsStore = createOpfsBlobStore(normalizedNamespace);
    opfsStoreByNamespace.set(normalizedNamespace, nextOpfsStore);
    return nextOpfsStore;
  }

  const existingMemoryStore = memoryStoreByNamespace.get(normalizedNamespace);
  if (existingMemoryStore) {
    return existingMemoryStore;
  }

  const nextMemoryStore = createMemoryBlobStore();
  memoryStoreByNamespace.set(normalizedNamespace, nextMemoryStore);
  return nextMemoryStore;
}
