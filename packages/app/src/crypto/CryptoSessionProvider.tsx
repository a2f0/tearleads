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
  useRef,
  useState,
} from "react";
import { useApiClient } from "../api/ApiClientProvider";
import {
  ensureContainerTables,
  loadContainers,
  saveContainer,
} from "../data/containerPersistence";
import { useDatabase } from "../db/DatabaseProvider";
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
  organizationId: string | null;
  containerId: string | null;
  authToken: string | null;
  isAuthenticated: boolean;
  generateKey: () => void;
  destroyKey: () => void;
  setUserId: (id: string | null) => void;
  setOrganizationId: (id: string | null) => void;
  setContainerId: (id: string | null) => void;
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
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [containerId, setContainerId] = useState<string | null>(null);
  const [authToken, setStoredAuthToken] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const { log } = useLog();
  const apiClient = useApiClient();
  const { client: dbClient, status: dbStatus } = useDatabase();
  const containerBootstrapped = useRef(false);

  useEffect(() => {
    if (dbStatus !== "ready" || !dbClient || containerBootstrapped.current) {
      return;
    }
    containerBootstrapped.current = true;

    const execSql = async (
      sql: string,
      bind?: Record<string, string | number | null>,
    ) => {
      const result = await dbClient.exec(bind ? { sql, bind } : { sql });
      return result.rows;
    };

    void (async () => {
      try {
        await ensureContainerTables(execSql);
        const containers = await loadContainers(execSql);
        const root = containers.find((c) => c.parentId === null);

        if (root) {
          setContainerId(root.id);
        } else {
          const id = crypto.randomUUID();
          await saveContainer(execSql, {
            id,
            organizationId: "",
            parentId: null,
            name: "/",
          });
          setContainerId(id);
          log("Root container created");
        }
      } catch (error: unknown) {
        console.error("Failed to bootstrap root container:", error);
      }
    })();
  }, [dbStatus, dbClient, log]);

  const generateKey = useCallback(() => {
    setSigningKeyPair(generateSigningSeedAndKeyPair());
    setEncapsulationKeyPair(generateKemSeedAndKeyPair());
    setIsAuthenticated(false);
    apiClient.setAuthToken(null);
    log("Key pair generated");
  }, [log, apiClient]);

  const destroyKey = useCallback(() => {
    setSigningKeyPair(null);
    setEncapsulationKeyPair(null);
    setUserId(null);
    setOrganizationId(null);
    setContainerId(null);
    setStoredAuthToken(null);
    setIsAuthenticated(false);
    apiClient.setAuthToken(null);
    log("Key pair destroyed");
  }, [log, apiClient]);

  const logout = useCallback(() => {
    setStoredAuthToken(null);
    setIsAuthenticated(false);
    apiClient.setAuthToken(null);
  }, [apiClient]);

  const login = useCallback(async (): Promise<boolean> => {
    if (!signingKeyPair) return false;
    const fingerprint = await toFingerprint(signingKeyPair.signingPublicKey);
    log("Authenticating...");
    const token = await apiClient.authenticate(
      fingerprint,
      signingKeyPair.signingPrivateKey,
    );
    if (token) {
      apiClient.setAuthToken(token);
      setStoredAuthToken(token);
      setIsAuthenticated(true);
      log("Authentication successful");
      return true;
    }
    setIsAuthenticated(false);
    log("Authentication failed");
    return false;
  }, [signingKeyPair, log, apiClient]);

  const loginWithChallenge = useCallback(
    async (challengeHex: string): Promise<boolean> => {
      if (!signingKeyPair) return false;
      const fingerprint = await toFingerprint(signingKeyPair.signingPublicKey);
      log("Authenticating with challenge...");
      const token = await apiClient.authenticateWithChallenge(
        fingerprint,
        signingKeyPair.signingPrivateKey,
        challengeHex,
      );
      if (token) {
        apiClient.setAuthToken(token);
        setStoredAuthToken(token);
        setIsAuthenticated(true);
        log("Authentication successful");
        return true;
      }
      setIsAuthenticated(false);
      log("Authentication failed");
      return false;
    },
    [signingKeyPair, log, apiClient],
  );

  return (
    <CryptoSessionContext.Provider
      value={{
        signingKeyPair,
        encapsulationKeyPair,
        userId,
        organizationId,
        containerId,
        authToken,
        isAuthenticated,
        generateKey,
        destroyKey,
        setUserId,
        setOrganizationId,
        setContainerId,
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
