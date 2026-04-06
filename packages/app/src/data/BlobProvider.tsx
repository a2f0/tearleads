import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from "react";
import { usePersona } from "../persona/PersonaProvider";
import { type BlobStore, createBlobStore } from "./blob-store";

const BlobContext = createContext<BlobStore | null>(null);

export function BlobProvider({ children }: PropsWithChildren) {
  const { signingFingerprint } = usePersona();
  const blobStore = useMemo(
    () => createBlobStore(signingFingerprint),
    [signingFingerprint],
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
