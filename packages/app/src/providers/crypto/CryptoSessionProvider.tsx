import { toFingerprint } from "@tearleads/crypto";
import {
  createContext,
  type MutableRefObject,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { bootstrapRootContainer } from "../../workflows/registration";
import { useApiClient } from "../api/ApiClientProvider";
import { useDatabase } from "../db/DatabaseProvider";
import { useIdentity } from "../identity/IdentityProvider";
import { useLog } from "../logging/LogProvider";

interface CryptoSessionContextValue {
  userId: string | null;
  organizationId: string | null;
  containerId: string | null;
  authToken: string | null;
  isAuthenticated: boolean;
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

function resetCryptoSessionState(
  apiClient: ReturnType<typeof useApiClient>,
  setUserId: (value: string | null) => void,
  setOrganizationId: (value: string | null) => void,
  setContainerId: (value: string | null) => void,
  setStoredAuthToken: (value: string | null) => void,
  setIsAuthenticated: (value: boolean) => void,
) {
  setUserId(null);
  setOrganizationId(null);
  setContainerId(null);
  setStoredAuthToken(null);
  setIsAuthenticated(false);
  apiClient.setAuthToken(null);
}

async function authenticateCurrentIdentity(
  apiClient: ReturnType<typeof useApiClient>,
  fingerprint: string,
  signingPrivateKey: Uint8Array,
  log: (message: string) => void,
  challengeHex?: string,
) {
  log(challengeHex ? "Authenticating with challenge..." : "Authenticating...");

  const token = challengeHex
    ? await apiClient.authenticateWithChallenge(
        fingerprint,
        signingPrivateKey,
        challengeHex,
      )
    : await apiClient.authenticate(fingerprint, signingPrivateKey);

  if (!token) {
    log("Authentication failed");
    return null;
  }

  log("Authentication successful");
  return token;
}

function useResetCryptoSession(
  containerBootstrapped: MutableRefObject<string | null>,
  signingKeyPair: ReturnType<typeof useIdentity>["signingKeyPair"],
  apiClient: ReturnType<typeof useApiClient>,
  setUserId: (value: string | null) => void,
  setOrganizationId: (value: string | null) => void,
  setContainerId: (value: string | null) => void,
  setStoredAuthToken: (value: string | null) => void,
  setIsAuthenticated: (value: boolean) => void,
) {
  useEffect(() => {
    if (signingKeyPair) {
      return;
    }

    containerBootstrapped.current = null;
    resetCryptoSessionState(
      apiClient,
      setUserId,
      setOrganizationId,
      setContainerId,
      setStoredAuthToken,
      setIsAuthenticated,
    );
  }, [apiClient, signingKeyPair]);
}

function useBootstrapCryptoSessionContainer(
  containerBootstrapped: MutableRefObject<string | null>,
  signingFingerprint: string | null,
  dbStatus: ReturnType<typeof useDatabase>["status"],
  dbClient: ReturnType<typeof useDatabase>["client"],
  log: (message: string) => void,
  logError: (message: string, error: unknown) => void,
  setContainerId: (value: string | null) => void,
) {
  useEffect(() => {
    const bootstrapKey =
      signingFingerprint && dbClient
        ? `${signingFingerprint}:${dbStatus}`
        : null;

    if (
      !signingFingerprint ||
      dbStatus !== "ready" ||
      !dbClient ||
      containerBootstrapped.current === bootstrapKey
    ) {
      return;
    }
    containerBootstrapped.current = bootstrapKey;

    void (async () => {
      try {
        const bootstrap = await bootstrapRootContainer(dbClient);
        setContainerId(bootstrap.containerId);
        if (bootstrap.created) {
          log("Root container created");
        }
      } catch (error: unknown) {
        containerBootstrapped.current = null;
        logError("Failed to bootstrap root container", error);
      }
    })();
  }, [dbStatus, dbClient, log, logError, signingFingerprint]);
}

function useCryptoAuthActions(
  apiClient: ReturnType<typeof useApiClient>,
  signingKeyPair: ReturnType<typeof useIdentity>["signingKeyPair"],
  log: (message: string) => void,
  setStoredAuthToken: (value: string | null) => void,
  setIsAuthenticated: (value: boolean) => void,
) {
  const logout = useCallback(() => {
    setStoredAuthToken(null);
    setIsAuthenticated(false);
    apiClient.setAuthToken(null);
  }, [apiClient, setIsAuthenticated, setStoredAuthToken]);

  const authenticate = useCallback(
    async (challengeHex?: string): Promise<boolean> => {
      if (!signingKeyPair) {
        return false;
      }
      const fingerprint = await toFingerprint(signingKeyPair.signingPublicKey);
      const token = await authenticateCurrentIdentity(
        apiClient,
        fingerprint,
        signingKeyPair.signingPrivateKey,
        log,
        challengeHex,
      );
      if (!token) {
        setIsAuthenticated(false);
        return false;
      }

      apiClient.setAuthToken(token);
      setStoredAuthToken(token);
      setIsAuthenticated(true);
      return true;
    },
    [apiClient, log, setIsAuthenticated, setStoredAuthToken, signingKeyPair],
  );

  const loginWithChallenge = useCallback(
    (challengeHex: string) => authenticate(challengeHex),
    [authenticate],
  );

  return {
    login: () => authenticate(),
    loginWithChallenge,
    logout,
  };
}

export function CryptoSessionProvider({ children }: PropsWithChildren) {
  const [userId, setUserId] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [containerId, setContainerId] = useState<string | null>(null);
  const [authToken, setStoredAuthToken] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const { log, logError } = useLog();
  const apiClient = useApiClient();
  const { client: dbClient, status: dbStatus } = useDatabase();
  const { signingFingerprint, signingKeyPair } = useIdentity();
  const containerBootstrapped = useRef<string | null>(null);

  useResetCryptoSession(
    containerBootstrapped,
    signingKeyPair,
    apiClient,
    setUserId,
    setOrganizationId,
    setContainerId,
    setStoredAuthToken,
    setIsAuthenticated,
  );
  useBootstrapCryptoSessionContainer(
    containerBootstrapped,
    signingFingerprint,
    dbStatus,
    dbClient,
    log,
    logError,
    setContainerId,
  );
  const { login, loginWithChallenge, logout } = useCryptoAuthActions(
    apiClient,
    signingKeyPair,
    log,
    setStoredAuthToken,
    setIsAuthenticated,
  );

  return (
    <CryptoSessionContext.Provider
      value={{
        userId,
        organizationId,
        containerId,
        authToken,
        isAuthenticated,
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
