import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from "react";
import { createBlobStore } from "../../data/blobs/createBlobStore";
import { createMemoryBlobStore } from "../../data/blobs/memoryBlobStore";
import type { BlobStore } from "../../data/blobs/types";
import { useIdentity } from "../identity/IdentityProvider";

const BlobContext = createContext<BlobStore | null>(null);

export function BlobProvider({ children }: PropsWithChildren) {
  const { signingFingerprint } = useIdentity();
  const ephemeralBlobStore = useMemo(() => createMemoryBlobStore(), []);
  const blobStore = useMemo(
    () =>
      signingFingerprint
        ? createBlobStore(signingFingerprint)
        : ephemeralBlobStore,
    [ephemeralBlobStore, signingFingerprint],
  );

  return (
    <BlobContext.Provider value={blobStore}>{children}</BlobContext.Provider>
  );
}

export function useBlobStore(): BlobStore {
  const context = useContext(BlobContext);
  if (!context) {
    throw new Error("useBlobStore must be used within a BlobProvider.");
  }

  return context;
}
