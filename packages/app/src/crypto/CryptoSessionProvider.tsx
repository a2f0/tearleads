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
  useState,
} from "react";
import { authenticate, authenticateWithChallenge } from "../api/routes/auth";
import { setAuthToken } from "../api/util/request";
import { useLog } from "../logging/LogProvider";

interface SigningKeyPair {
  signingPublicKey: Uint8Array;
  signingPrivateKey: Uint8Array;
}

interface EncapsulationKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

interface CryptoSessionContextValue {
  signingKeyPair: SigningKeyPair | null;
  encapsulationKeyPair: EncapsulationKeyPair | null;
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
  const [signingKeyPair, setSigningKeyPair] = useState<SigningKeyPair | null>(
    null,
  );
  const [encapsulationKeyPair, setEncapsulationKeyPair] =
    useState<EncapsulationKeyPair | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [authToken, setStoredAuthToken] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const { log } = useLog();

  const generateKey = useCallback(() => {
    setSigningKeyPair(generateSigningSeedAndKeyPair());
    setEncapsulationKeyPair(generateKemSeedAndKeyPair());
    setIsAuthenticated(false);
    setAuthToken(null);
    log("Key pair generated");
  }, [log]);

  const destroyKey = useCallback(() => {
    setSigningKeyPair(null);
    setEncapsulationKeyPair(null);
    setUserId(null);
    setStoredAuthToken(null);
    setIsAuthenticated(false);
    setAuthToken(null);
    log("Key pair destroyed");
  }, [log]);

  const logout = useCallback(() => {
    setStoredAuthToken(null);
    setIsAuthenticated(false);
    setAuthToken(null);
  }, []);

  const login = useCallback(async (): Promise<boolean> => {
    if (!signingKeyPair) return false;
    const fingerprint = await toFingerprint(signingKeyPair.signingPublicKey);
    log("Authenticating...");
    const token = await authenticate(
      fingerprint,
      signingKeyPair.signingPrivateKey,
    );
    if (token) {
      setAuthToken(token);
      setStoredAuthToken(token);
      setIsAuthenticated(true);
      log("Authentication successful");
      return true;
    }
    setIsAuthenticated(false);
    log("Authentication failed");
    return false;
  }, [signingKeyPair, log]);

  const loginWithChallenge = useCallback(
    async (challengeHex: string): Promise<boolean> => {
      if (!signingKeyPair) return false;
      const fingerprint = await toFingerprint(signingKeyPair.signingPublicKey);
      log("Authenticating with challenge...");
      const token = await authenticateWithChallenge(
        fingerprint,
        signingKeyPair.signingPrivateKey,
        challengeHex,
      );
      if (token) {
        setAuthToken(token);
        setStoredAuthToken(token);
        setIsAuthenticated(true);
        log("Authentication successful");
        return true;
      }
      setIsAuthenticated(false);
      log("Authentication failed");
      return false;
    },
    [signingKeyPair, log],
  );

  return (
    <CryptoSessionContext.Provider
      value={{
        signingKeyPair,
        encapsulationKeyPair,
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
