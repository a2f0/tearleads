import { generateSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useState,
} from "react";

interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

interface CryptoSessionContextValue {
  keyPair: KeyPair | null;
  generateKey: () => void;
  destroyKey: () => void;
}

const CryptoSessionContext = createContext<CryptoSessionContextValue | null>(
  null,
);

export function CryptoSessionProvider({ children }: PropsWithChildren) {
  const [keyPair, setKeyPair] = useState<KeyPair | null>(null);

  const generateKey = useCallback(() => {
    setKeyPair(generateSeedAndKeyPair());
  }, []);

  const destroyKey = useCallback(() => {
    setKeyPair(null);
  }, []);

  return (
    <CryptoSessionContext.Provider value={{ keyPair, generateKey, destroyKey }}>
      {children}
    </CryptoSessionContext.Provider>
  );
}

export function useCryptoSession(): CryptoSessionContextValue {
  const context = useContext(CryptoSessionContext);
  if (!context) {
    throw new Error(
      "useCryptoSession must be used within a CryptoSessionProvider.",
    );
  }
  return context;
}
