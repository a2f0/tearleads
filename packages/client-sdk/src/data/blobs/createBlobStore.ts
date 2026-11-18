import type { BlobStore } from "./blobContracts";
import { createOpfsBlobStore, isOpfsBlobStoreSupported } from "./opfsBlobStore";

// namespace is a 64-character hex SHA-256 fingerprint of the
// signing public key bytes.
export function createBlobStore(namespace: string): BlobStore {
  if (!isOpfsBlobStoreSupported()) {
    throw new Error("OPFS blob store is not supported.");
  }

  return createOpfsBlobStore(namespace);
}
