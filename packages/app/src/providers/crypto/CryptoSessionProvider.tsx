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
import { useDatabase } from "../db/DatabaseProvider";
import { useIdentity } from "../identity/IdentityProvider";
import { useLog } from "../logging/LogProvider";
import { useTearleads } from "../sdk/TearleadsProvider";

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
}

function useResetCryptoSession(
  containerBootstrapped: MutableRefObject<string | null>,
  signingKeyPair: ReturnType<typeof useIdentity>["signingKeyPair"],
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
      setUserId,
      setOrganizationId,
      setContainerId,
      setStoredAuthToken,
      setIsAuthenticated,
    );
  }, [
    setContainerId,
    setIsAuthenticated,
    setOrganizationId,
    setStoredAuthToken,
    setUserId,
    signingKeyPair,
  ]);
}

function useBootstrapCryptoSessionContainer(
  containerBootstrapped: MutableRefObject<string | null>,
  tearleads: ReturnType<typeof useTearleads>,
  signingFingerprint: string | null,
  dbStatus: ReturnType<typeof useDatabase>["status"],
  dbClient: ReturnType<typeof useDatabase>["client"],
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
        tearleads.db.configure({
          client: dbClient,
          status: dbStatus,
        });
        const bootstrap = await tearleads.session.bootstrapLocalRootContainer();
        setContainerId(bootstrap.containerId);
      } catch (error: unknown) {
        containerBootstrapped.current = null;
        logError("Failed to bootstrap root container", error);
      }
    })();
  }, [
    dbStatus,
    dbClient,
    logError,
    setContainerId,
    signingFingerprint,
    tearleads,
  ]);
}

function useCryptoAuthActions(
  tearleads: ReturnType<typeof useTearleads>,
  signingKeyPair: ReturnType<typeof useIdentity>["signingKeyPair"],
  setStoredAuthToken: (value: string | null) => void,
  setIsAuthenticated: (value: boolean) => void,
) {
  const logout = useCallback(() => {
    tearleads.session.logout();
    setStoredAuthToken(tearleads.session.authToken);
    setIsAuthenticated(tearleads.session.isAuthenticated);
  }, [setIsAuthenticated, setStoredAuthToken, tearleads]);

  const authenticate = useCallback(
    async (challengeHex?: string): Promise<boolean> => {
      if (!signingKeyPair) {
        return false;
      }

      const authenticated = await tearleads.session.login(challengeHex);
      setStoredAuthToken(tearleads.session.authToken);
      setIsAuthenticated(tearleads.session.isAuthenticated);
      return authenticated;
    },
    [setIsAuthenticated, setStoredAuthToken, signingKeyPair, tearleads],
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

function useSdkBackedCryptoSessionState(
  tearleads: ReturnType<typeof useTearleads>,
) {
  const [userId, setStoredUserId] = useState<string | null>(null);
  const [organizationId, setStoredOrganizationId] = useState<string | null>(
    null,
  );
  const [containerId, setStoredContainerId] = useState<string | null>(null);
  const [authToken, setStoredAuthTokenState] = useState<string | null>(null);
  const [isAuthenticated, setStoredIsAuthenticated] = useState(false);
  const setUserId = useCallback(
    (value: string | null) => {
      tearleads.session.setUserId(value);
      setStoredUserId(value);
    },
    [tearleads],
  );
  const setOrganizationId = useCallback(
    (value: string | null) => {
      tearleads.session.setOrganizationId(value);
      setStoredOrganizationId(value);
    },
    [tearleads],
  );
  const setContainerId = useCallback(
    (value: string | null) => {
      tearleads.session.setContainerId(value);
      setStoredContainerId(value);
    },
    [tearleads],
  );
  const setStoredAuthToken = useCallback(
    (value: string | null) => {
      tearleads.session.setAuthToken(value);
      setStoredAuthTokenState(value);
    },
    [tearleads],
  );
  const setIsAuthenticated = useCallback(
    (value: boolean) => {
      tearleads.session.setContext({ isAuthenticated: value });
      setStoredIsAuthenticated(value);
    },
    [tearleads],
  );

  return {
    authToken,
    containerId,
    isAuthenticated,
    organizationId,
    setContainerId,
    setIsAuthenticated,
    setOrganizationId,
    setStoredAuthToken,
    setUserId,
    userId,
  };
}

export function CryptoSessionProvider({ children }: PropsWithChildren) {
  const tearleads = useTearleads();
  const { logError } = useLog();
  const { client: dbClient, status: dbStatus } = useDatabase();
  const { signingFingerprint, signingKeyPair } = useIdentity();
  const containerBootstrapped = useRef<string | null>(null);
  const sessionState = useSdkBackedCryptoSessionState(tearleads);

  useResetCryptoSession(
    containerBootstrapped,
    signingKeyPair,
    sessionState.setUserId,
    sessionState.setOrganizationId,
    sessionState.setContainerId,
    sessionState.setStoredAuthToken,
    sessionState.setIsAuthenticated,
  );
  useBootstrapCryptoSessionContainer(
    containerBootstrapped,
    tearleads,
    signingFingerprint,
    dbStatus,
    dbClient,
    logError,
    sessionState.setContainerId,
  );
  const { login, loginWithChallenge, logout } = useCryptoAuthActions(
    tearleads,
    signingKeyPair,
    sessionState.setStoredAuthToken,
    sessionState.setIsAuthenticated,
  );

  return (
    <CryptoSessionContext.Provider
      value={{
        userId: sessionState.userId,
        organizationId: sessionState.organizationId,
        containerId: sessionState.containerId,
        authToken: sessionState.authToken,
        isAuthenticated: sessionState.isAuthenticated,
        setUserId: sessionState.setUserId,
        setOrganizationId: sessionState.setOrganizationId,
        setContainerId: sessionState.setContainerId,
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
