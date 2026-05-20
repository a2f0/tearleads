import type { BlobStore } from "@tearleads/client-sdk/workflows/blobs";
import { createContext, type PropsWithChildren, useContext } from "react";
import { useIdentity } from "../identity/IdentityProvider";
import { useTearleads } from "../sdk/TearleadsProvider";

const BlobContext = createContext<BlobStore | null>(null);

export function BlobProvider({ children }: PropsWithChildren) {
  const tearleads = useTearleads();
  useIdentity();
  const blobStore = tearleads.blobs.store;

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
