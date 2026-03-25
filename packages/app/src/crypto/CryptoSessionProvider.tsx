import { generateSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useState,
} from "react";
import { authenticate, authenticateWithChallenge } from "../api/routes/auth";
import { setAuthToken } from "../api/util/request";

interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

interface CryptoSessionContextValue {
  keyPair: KeyPair | null;
  userId: string | null;
  authToken: string | null;
  isAuthenticated: boolean;
  generateKey: () => void;
  destroyKey: () => void;
  setUserId: (id: string | null) => void;
  login: () => Promise<boolean>;
  loginWithChallenge: (challengeHex: string) => Promise<boolean>;
  logout: () => void;
}

const CryptoSessionContext = createContext<CryptoSessionContextValue | null>(
  null,
);

export function CryptoSessionProvider({ children }: PropsWithChildren) {
  const [keyPair, setKeyPair] = useState<KeyPair | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [authToken, setStoredAuthToken] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const generateKey = useCallback(() => {
    setKeyPair(generateSeedAndKeyPair());
    setIsAuthenticated(false);
    setAuthToken(null);
  }, []);

  const destroyKey = useCallback(() => {
    setKeyPair(null);
    setUserId(null);
    setStoredAuthToken(null);
    setIsAuthenticated(false);
    setAuthToken(null);
  }, []);

  const logout = useCallback(() => {
    setStoredAuthToken(null);
    setIsAuthenticated(false);
    setAuthToken(null);
  }, []);

  const login = useCallback(async (): Promise<boolean> => {
    if (!keyPair) return false;
    const fingerprint = await toFingerprint(keyPair.publicKey);
    const token = await authenticate(fingerprint, keyPair.secretKey);
    if (token) {
      setAuthToken(token);
      setStoredAuthToken(token);
      setIsAuthenticated(true);
      return true;
    }
    setIsAuthenticated(false);
    return false;
  }, [keyPair]);

  const loginWithChallenge = useCallback(
    async (challengeHex: string): Promise<boolean> => {
      if (!keyPair) return false;
      const fingerprint = await toFingerprint(keyPair.publicKey);
      const token = await authenticateWithChallenge(
        fingerprint,
        keyPair.secretKey,
        challengeHex,
      );
      if (token) {
        setAuthToken(token);
        setStoredAuthToken(token);
        setIsAuthenticated(true);
        return true;
      }
      setIsAuthenticated(false);
      return false;
    },
    [keyPair],
  );

  return (
    <CryptoSessionContext.Provider
      value={{
        keyPair,
        userId,
        authToken,
        isAuthenticated,
        generateKey,
        destroyKey,
        setUserId,
        login,
        loginWithChallenge,
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
