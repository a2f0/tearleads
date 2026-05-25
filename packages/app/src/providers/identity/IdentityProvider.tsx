import type { IdentityKeyPackage } from "@tearleads/client-sdk";
import type { EncapsulationKeyPair, SigningKeyPair } from "@tearleads/crypto";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from "react";
import { useTearleads } from "../sdk/TearleadsProvider";
import { useTearleadsStoreSnapshot } from "../sdk/useTearleadsSubscription";

interface IdentityContextValue {
  encapsulationKeyPair: EncapsulationKeyPair | null;
  destroyKey: () => void;
  exportKeyPackage: () => Promise<IdentityKeyPackage>;
  generateKey: () => void;
  restoreKeyPackage: (keyPackage: unknown) => Promise<void>;
  signingFingerprint: string | null;
  signingKeyPair: SigningKeyPair | null;
}

const IdentityContext = createContext<IdentityContextValue | null>(null);

export function IdentityProvider({ children }: PropsWithChildren) {
  const tearleads = useTearleads();
  const generationInFlight = useRef(false);
  const generationIdRef = useRef(0);
  const snapshot = useTearleadsStoreSnapshot(tearleads.identity);

  const generateKey = useCallback(() => {
    if (generationInFlight.current) {
      return;
    }

    const generationId = generationIdRef.current + 1;
    generationIdRef.current = generationId;
    generationInFlight.current = true;
    void tearleads.identity
      .generate()
      .then(() => {
        if (generationIdRef.current !== generationId) {
          return;
        }

        generationInFlight.current = false;
      })
      .catch((error: unknown) => {
        if (generationIdRef.current !== generationId) {
          return;
        }

        generationInFlight.current = false;
        tearleads.logError("Failed to generate identity keys", error);
      });
  }, [tearleads]);

  const destroyKey = useCallback(() => {
    generationIdRef.current += 1;
    generationInFlight.current = false;
    tearleads.identity.destroy();
  }, [tearleads]);

  const exportKeyPackage = useCallback(
    () => tearleads.identity.exportKeyPackage(),
    [tearleads],
  );

  const restoreKeyPackage = useCallback(
    async (keyPackage: unknown) => {
      generationIdRef.current += 1;
      generationInFlight.current = false;
      await tearleads.identity.importKeyPackage(keyPackage);
    },
    [tearleads],
  );

  const value = useMemo(
    () => ({
      encapsulationKeyPair: snapshot.encapsulationKeyPair,
      destroyKey,
      exportKeyPackage,
      generateKey,
      restoreKeyPackage,
      signingFingerprint: snapshot.signingFingerprint,
      signingKeyPair: snapshot.signingKeyPair,
    }),
    [
      destroyKey,
      exportKeyPackage,
      generateKey,
      restoreKeyPackage,
      snapshot.encapsulationKeyPair,
      snapshot.signingFingerprint,
      snapshot.signingKeyPair,
    ],
  );

  return (
    <IdentityContext.Provider value={value}>
      {children}
    </IdentityContext.Provider>
  );
}

export function useIdentity(): IdentityContextValue {
  const context = useContext(IdentityContext);
  if (!context) {
    throw new Error("useIdentity must be used within an IdentityProvider.");
  }

  return context;
}
