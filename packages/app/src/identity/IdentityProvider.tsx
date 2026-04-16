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

interface IdentityContextValue {
  encapsulationKeyPair: EncapsulationKeyPair | null;
  destroyKey: () => void;
  generateKey: () => void;
  signingFingerprint: string | null;
  signingKeyPair: SigningKeyPair | null;
}

const IdentityContext = createContext<IdentityContextValue | null>(null);

export function IdentityProvider({ children }: PropsWithChildren) {
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
