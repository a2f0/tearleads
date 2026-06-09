import {
  createContext,
  type MutableRefObject,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { useDatabase } from "../db/DatabaseProvider";
import { useIdentity } from "../identity/IdentityProvider";
import { useLog } from "../logging/LogProvider";
import { useTearleads } from "../sdk/TearleadsProvider";
import { useTearleadsStoreSnapshot } from "../sdk/useTearleadsSubscription";

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

function useResetCryptoSession(
  containerBootstrapped: MutableRefObject<string | null>,
  signingKeyPair: ReturnType<typeof useIdentity>["signingKeyPair"],
  resetSession: () => void,
) {
  useEffect(() => {
    if (signingKeyPair) {
      return;
    }

    containerBootstrapped.current = null;
    resetSession();
  }, [resetSession, signingKeyPair]);
}

function useBootstrapCryptoSessionContainer(
  containerBootstrapped: MutableRefObject<string | null>,
  tearleads: ReturnType<typeof useTearleads>,
  containerId: string | null,
  signingFingerprint: string | null,
  dbStatus: ReturnType<typeof useDatabase>["status"],
  dbClient: ReturnType<typeof useDatabase>["client"],
  logError: (message: string, error: unknown) => void,
) {
  useEffect(() => {
    const bootstrapKey =
      signingFingerprint && dbClient
        ? `${signingFingerprint}:${dbStatus}`
        : null;

    if (
      containerId !== null ||
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
        await tearleads.session.bootstrapLocalRootContainer();
      } catch (error: unknown) {
        containerBootstrapped.current = null;
        logError("Failed to bootstrap root container", error);
      }
    })();
  }, [
    dbStatus,
    dbClient,
    containerId,
    logError,
    signingFingerprint,
    tearleads,
  ]);
}

function useEnsureDatabaseForIdentity(
  signingFingerprint: string | null,
  dbStatus: ReturnType<typeof useDatabase>["status"],
  ensureIdentityDatabaseReady: ReturnType<
    typeof useDatabase
  >["ensureIdentityReady"],
  logError: (message: string, error: unknown) => void,
) {
  useEffect(() => {
    if (!signingFingerprint || dbStatus !== "idle") {
      return;
    }

    void ensureIdentityDatabaseReady(signingFingerprint).catch(
      (error: unknown) => {
        logError("Failed to initialize SQLite for local identity", error);
      },
    );
  }, [dbStatus, ensureIdentityDatabaseReady, logError, signingFingerprint]);
}

function useCryptoAuthActions(tearleads: ReturnType<typeof useTearleads>) {
  const logout = useCallback(() => {
    tearleads.session.logout();
  }, [tearleads]);

  const authenticate = useCallback(
    async (challengeHex?: string): Promise<boolean> => {
      if (!tearleads.identity.signingKeyPair) {
        return false;
      }

      return tearleads.session.login(challengeHex);
    },
    [tearleads],
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

function useAutoLoginRestoredSession(input: {
  readonly authToken: string | null;
  readonly isAuthenticated: boolean;
  readonly localIdentityRestoredFingerprint: string | null;
  readonly logError: (message: string, error: unknown) => void;
  readonly signingFingerprint: string | null;
  readonly signingKeyPair: ReturnType<typeof useIdentity>["signingKeyPair"];
  readonly tearleads: ReturnType<typeof useTearleads>;
}) {
  const {
    authToken,
    isAuthenticated,
    localIdentityRestoredFingerprint,
    logError,
    signingFingerprint,
    signingKeyPair,
    tearleads,
  } = input;
  const attemptedFingerprint = useRef<string | null>(null);

  useEffect(() => {
    if (!signingKeyPair || !signingFingerprint) {
      attemptedFingerprint.current = null;
      return;
    }

    if (
      authToken ||
      isAuthenticated ||
      localIdentityRestoredFingerprint !== signingFingerprint ||
      attemptedFingerprint.current === signingFingerprint
    ) {
      return;
    }

    attemptedFingerprint.current = signingFingerprint;
    void tearleads.session.login().catch((error: unknown) => {
      logError("Failed to authenticate restored local identity", error);
    });
  }, [
    authToken,
    isAuthenticated,
    localIdentityRestoredFingerprint,
    logError,
    signingFingerprint,
    signingKeyPair,
    tearleads,
  ]);
}

function useSdkBackedCryptoSessionState(
  tearleads: ReturnType<typeof useTearleads>,
) {
  const snapshot = useTearleadsStoreSnapshot(tearleads.session);
  const setUserId = useCallback(
    (value: string | null) => {
      tearleads.session.setUserId(value);
    },
    [tearleads],
  );
  const setOrganizationId = useCallback(
    (value: string | null) => {
      tearleads.session.setOrganizationId(value);
    },
    [tearleads],
  );
  const setContainerId = useCallback(
    (value: string | null) => {
      tearleads.session.setContainerId(value);
    },
    [tearleads],
  );
  const resetSession = useCallback(() => {
    tearleads.session.setContext({
      authToken: null,
      containerId: null,
      isAuthenticated: false,
      organizationId: null,
      userId: null,
    });
  }, [tearleads]);

  return {
    authToken: snapshot.authToken,
    containerId: snapshot.containerId,
    isAuthenticated: snapshot.isAuthenticated,
    organizationId: snapshot.organizationId,
    resetSession,
    setContainerId,
    setOrganizationId,
    setUserId,
    userId: snapshot.userId,
  };
}

export function CryptoSessionProvider({ children }: PropsWithChildren) {
  const tearleads = useTearleads();
  const { logError } = useLog();
  const {
    client: dbClient,
    ensureIdentityReady: ensureIdentityDatabaseReady,
    status: dbStatus,
  } = useDatabase();
  const {
    localIdentityRestoredFingerprint,
    signingFingerprint,
    signingKeyPair,
  } = useIdentity();
  const containerBootstrapped = useRef<string | null>(null);
  const sessionState = useSdkBackedCryptoSessionState(tearleads);

  useResetCryptoSession(
    containerBootstrapped,
    signingKeyPair,
    sessionState.resetSession,
  );
  useEnsureDatabaseForIdentity(
    signingFingerprint,
    dbStatus,
    ensureIdentityDatabaseReady,
    logError,
  );
  useBootstrapCryptoSessionContainer(
    containerBootstrapped,
    tearleads,
    sessionState.containerId,
    signingFingerprint,
    dbStatus,
    dbClient,
    logError,
  );
  useAutoLoginRestoredSession({
    authToken: sessionState.authToken,
    isAuthenticated: sessionState.isAuthenticated,
    localIdentityRestoredFingerprint,
    logError,
    signingFingerprint,
    signingKeyPair,
    tearleads,
  });
  const { login, loginWithChallenge, logout } = useCryptoAuthActions(tearleads);

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
