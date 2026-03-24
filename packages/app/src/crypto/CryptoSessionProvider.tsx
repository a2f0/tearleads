import { generateSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useState,
} from "react";
import { authenticate } from "../api/routes/auth";

interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

interface CryptoSessionContextValue {
  keyPair: KeyPair | null;
  isAuthenticated: boolean;
  generateKey: () => void;
  destroyKey: () => void;
  login: () => Promise<boolean>;
}

const CryptoSessionContext = createContext<CryptoSessionContextValue | null>(
  null,
);

export function CryptoSessionProvider({ children }: PropsWithChildren) {
  const [keyPair, setKeyPair] = useState<KeyPair | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const generateKey = useCallback(() => {
    setKeyPair(generateSeedAndKeyPair());
    setIsAuthenticated(false);
  }, []);

  const destroyKey = useCallback(() => {
    setKeyPair(null);
    setIsAuthenticated(false);
  }, []);

  const login = useCallback(async (): Promise<boolean> => {
    if (!keyPair) return false;
    const fingerprint = await toFingerprint(keyPair.publicKey);
    const result = await authenticate(fingerprint, keyPair.secretKey);
    setIsAuthenticated(result);
    return result;
  }, [keyPair]);

  return (
    <CryptoSessionContext.Provider
      value={{ keyPair, isAuthenticated, generateKey, destroyKey, login }}
    >
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
