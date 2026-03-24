import { generateSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useState,
} from "react";
import { authenticate } from "../api/routes/auth";
import { setAuthToken } from "../api/util/request";

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
  logout: () => void;
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
    setAuthToken(null);
  }, []);

  const destroyKey = useCallback(() => {
    setKeyPair(null);
    setIsAuthenticated(false);
    setAuthToken(null);
  }, []);

  const logout = useCallback(() => {
    setIsAuthenticated(false);
    setAuthToken(null);
  }, []);

  const login = useCallback(async (): Promise<boolean> => {
    if (!keyPair) return false;
    const fingerprint = await toFingerprint(keyPair.publicKey);
    const token = await authenticate(fingerprint, keyPair.secretKey);
    if (token) {
      setAuthToken(token);
      setIsAuthenticated(true);
      return true;
    }
    setIsAuthenticated(false);
    return false;
  }, [keyPair]);

  return (
    <CryptoSessionContext.Provider
      value={{
        keyPair,
        isAuthenticated,
        generateKey,
        destroyKey,
        login,
        logout,
      }}
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
