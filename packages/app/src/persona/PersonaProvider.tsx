import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useLog } from "../logging/LogProvider";

interface SigningKeyPair {
  signingPublicKey: Uint8Array;
  signingPrivateKey: Uint8Array;
}

interface EncapsulationKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

interface PersonaContextValue {
  encapsulationKeyPair: EncapsulationKeyPair | null;
  destroyKey: () => void;
  generateKey: () => void;
  signingFingerprint: string | null;
  signingKeyPair: SigningKeyPair | null;
}

const PersonaContext = createContext<PersonaContextValue | null>(null);

export function PersonaProvider({ children }: PropsWithChildren) {
  const [signingKeyPair, setSigningKeyPair] = useState<SigningKeyPair | null>(
    null,
  );
  const [encapsulationKeyPair, setEncapsulationKeyPair] =
    useState<EncapsulationKeyPair | null>(null);
  const [signingFingerprint, setSigningFingerprint] = useState<string | null>(
    null,
  );
  const { log } = useLog();

  useEffect(() => {
    let cancelled = false;

    if (!signingKeyPair) {
      setSigningFingerprint(null);
      return () => {
        cancelled = true;
      };
    }

    void toFingerprint(signingKeyPair.signingPublicKey).then(
      (nextFingerprint) => {
        if (!cancelled) {
          setSigningFingerprint(nextFingerprint);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [signingKeyPair]);

  const generateKey = useCallback(() => {
    setSigningKeyPair(generateSigningSeedAndKeyPair());
    setEncapsulationKeyPair(generateKemSeedAndKeyPair());
    log("Key pair generated");
  }, [log]);

  const destroyKey = useCallback(() => {
    setSigningKeyPair(null);
    setEncapsulationKeyPair(null);
    setSigningFingerprint(null);
    log("Key pair destroyed");
  }, [log]);

  const value = useMemo(
    () => ({
      encapsulationKeyPair,
      destroyKey,
      generateKey,
      signingFingerprint,
      signingKeyPair,
    }),
    [
      encapsulationKeyPair,
      destroyKey,
      generateKey,
      signingFingerprint,
      signingKeyPair,
    ],
  );

  return (
    <PersonaContext.Provider value={value}>{children}</PersonaContext.Provider>
  );
}

export function usePersona(): PersonaContextValue {
  const context = useContext(PersonaContext);
  if (!context) {
    throw new Error("usePersona must be used within a PersonaProvider.");
  }

  return context;
}
