import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from "react";
import { usePersona } from "../../persona/PersonaProvider";
import { createBlobStore } from "./createBlobStore";
import { createMemoryBlobStore } from "./memoryBlobStore";
import type { BlobStore } from "./types";

const BlobContext = createContext<BlobStore | null>(null);

export function BlobProvider({ children }: PropsWithChildren) {
  const { signingFingerprint } = usePersona();
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
