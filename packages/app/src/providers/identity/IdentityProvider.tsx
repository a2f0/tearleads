import type { EncapsulationKeyPair, SigningKeyPair } from "@tearleads/crypto";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTearleads } from "../sdk/TearleadsProvider";

interface IdentityContextValue {
  encapsulationKeyPair: EncapsulationKeyPair | null;
  destroyKey: () => void;
  generateKey: () => void;
  signingFingerprint: string | null;
  signingKeyPair: SigningKeyPair | null;
}

const IdentityContext = createContext<IdentityContextValue | null>(null);

export function IdentityProvider({ children }: PropsWithChildren) {
  const tearleads = useTearleads();
  const generationInFlight = useRef(false);
  const generationIdRef = useRef(0);
  const [snapshot, setSnapshot] = useState(() => tearleads.identity.snapshot);

  const generateKey = useCallback(() => {
    if (generationInFlight.current) {
      return;
    }

    const generationId = generationIdRef.current + 1;
    generationIdRef.current = generationId;
    generationInFlight.current = true;
    void tearleads.identity
      .generate()
      .then((nextSnapshot) => {
        if (generationIdRef.current !== generationId) {
          return;
        }

        generationInFlight.current = false;
        setSnapshot(nextSnapshot);
      })
      .catch((error: unknown) => {
        if (generationIdRef.current !== generationId) {
          return;
        }

        generationInFlight.current = false;
        console.error("Failed to generate identity keys:", error);
      });
  }, [tearleads]);

  const destroyKey = useCallback(() => {
    generationIdRef.current += 1;
    generationInFlight.current = false;
    tearleads.identity.destroy();
    setSnapshot(tearleads.identity.snapshot);
  }, [tearleads]);

  const value = useMemo(
    () => ({
      encapsulationKeyPair: snapshot.encapsulationKeyPair,
      destroyKey,
      generateKey,
      signingFingerprint: snapshot.signingFingerprint,
      signingKeyPair: snapshot.signingKeyPair,
    }),
    [
      destroyKey,
      generateKey,
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
