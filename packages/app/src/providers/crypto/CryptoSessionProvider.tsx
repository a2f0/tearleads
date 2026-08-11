import {
  createContext,
  type MutableRefObject,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDatabase } from "../db/DatabaseProvider";
import { useAppHostConfig } from "../host/AppHostConfigProvider";
import { useIdentity } from "../identity/IdentityProvider";
import { useLocalKeyringLock } from "../local-keyring/LocalKeyringLockProvider";
import { useLog } from "../logging/LogProvider";
import { useTearleads } from "../sdk/TearleadsProvider";
import { useTearleadsStoreSnapshot } from "../sdk/useTearleadsSubscription";
import {
  type LocalCryptoSessionPersistence,
  type PersistedCryptoSessionContext,
  queueCryptoSessionPersistence,
  restorePersistedCryptoSession,
  useLocalCryptoSessionPersistence,
} from "./localCryptoSessionPersistence";
import { useEnsureDatabaseForIdentity } from "./useEnsureDatabaseForIdentity";

export interface CryptoSessionContextValue {
  userId: string | null;
  organizationId: string | null;
  containerId: string | null;
  authToken: string | null;
  isAuthenticated: boolean;
  /**
   * Whether the attempt to restore a persisted crypto session for the current
   * identity has settled — `false` while a restore is in flight, `true` once it
   * finishes (or there is no persisted session). The identity autopilot waits
   * for this before auto-registering so a returning user's restored session is
   * used instead of registering a duplicate one on every reload.
   */
  sessionRestoreSettled: boolean;
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
  const login = useCallback(() => authenticate(), [authenticate]);

  return useMemo(
    () => ({
      login,
      loginWithChallenge: authenticate,
      logout,
    }),
    [authenticate, login, logout],
  );
}

function useRestorePersistedSession(input: {
  readonly localPersistence: LocalCryptoSessionPersistence | null;
  readonly log: (message: string) => void;
  readonly logError: (message: string, error: unknown) => void;
  readonly sessionState: PersistedCryptoSessionContext;
  readonly signingFingerprint: string | null;
  readonly tearleads: ReturnType<typeof useTearleads>;
}) {
  const {
    localPersistence,
    log,
    logError,
    sessionState: { authToken },
    signingFingerprint,
    tearleads,
  } = input;
  const [checkedFingerprint, setCheckedFingerprint] = useState<string | null>(
    null,
  );
  const inFlightFingerprint = useRef<string | null>(null);
  useEffect(() => {
    if (!signingFingerprint) {
      setCheckedFingerprint(null);
      inFlightFingerprint.current = null;
      return;
    }
    const clearInFlightFingerprint = () => {
      if (inFlightFingerprint.current === signingFingerprint) {
        inFlightFingerprint.current = null;
      }
    };
    if (authToken) {
      setCheckedFingerprint(signingFingerprint);
      clearInFlightFingerprint();
      return;
    }
    if (!localPersistence) {
      // No persisted session source: the restore attempt is trivially settled.
      setCheckedFingerprint(signingFingerprint);
      clearInFlightFingerprint();
      return;
    }
    if (
      checkedFingerprint === signingFingerprint ||
      inFlightFingerprint.current === signingFingerprint
    ) {
      return;
    }

    let cancelled = false;
    inFlightFingerprint.current = signingFingerprint;
    void restorePersistedCryptoSession({
      localPersistence,
      signingFingerprint,
    })
      .then((persistedSession) => {
        if (cancelled) {
          clearInFlightFingerprint();
          return;
        }
        clearInFlightFingerprint();
        // Apply the restored session before marking the restore settled so a
        // consumer reacting to `sessionRestoreSettled` already sees the restored
        // userId (and does not, e.g., auto-register over a live session).
        if (persistedSession) {
          tearleads.session.setContext(persistedSession);
          log("Restored persisted crypto session");
        }
        setCheckedFingerprint(signingFingerprint);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          clearInFlightFingerprint();
          return;
        }
        clearInFlightFingerprint();
        setCheckedFingerprint(signingFingerprint);
        logError("Failed to restore persisted crypto session", error);
      });

    return () => {
      cancelled = true;
    };
  }, [
    authToken,
    checkedFingerprint,
    localPersistence,
    logError,
    signingFingerprint,
    tearleads,
  ]);

  return checkedFingerprint;
}

function usePersistCryptoSession(input: {
  readonly checkedFingerprint: string | null;
  readonly localPersistence: LocalCryptoSessionPersistence | null;
  readonly logError: (message: string, error: unknown) => void;
  readonly sessionState: PersistedCryptoSessionContext;
  readonly signingFingerprint: string | null;
}) {
  const {
    checkedFingerprint,
    localPersistence,
    logError,
    sessionState: {
      authToken,
      containerId,
      defaultOrganizationId,
      isAuthenticated,
      organizationId,
      userId,
    },
    signingFingerprint,
  } = input;
  useEffect(() => {
    if (
      !localPersistence ||
      !signingFingerprint ||
      checkedFingerprint !== signingFingerprint
    ) {
      return;
    }

    // A full empty context is used while locking or switching identities. Keep
    // the prior per-identity record intact so returning to that identity can
    // restore its session rather than treating the transition as a logout.
    if (
      !authToken &&
      !containerId &&
      !defaultOrganizationId &&
      !organizationId &&
      !userId
    ) {
      return;
    }

    void queueCryptoSessionPersistence({
      context: {
        authToken,
        containerId,
        defaultOrganizationId,
        isAuthenticated,
        organizationId,
        userId,
      },
      localPersistence,
      signingFingerprint,
    }).catch((error: unknown) => {
      logError("Failed to persist crypto session", error);
    });
  }, [
    authToken,
    checkedFingerprint,
    containerId,
    defaultOrganizationId,
    isAuthenticated,
    localPersistence,
    logError,
    organizationId,
    signingFingerprint,
    userId,
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
      defaultOrganizationId: null,
      isAuthenticated: false,
      organizationId: null,
      userId: null,
    });
  }, [tearleads]);

  return {
    authToken: snapshot.authToken,
    containerId: snapshot.containerId,
    defaultOrganizationId: snapshot.defaultOrganizationId,
    isAuthenticated: snapshot.isAuthenticated,
    organizationId: snapshot.organizationId,
    resetSession,
    setContainerId,
    setOrganizationId,
    setUserId,
    userId: snapshot.userId,
  };
}

function useCryptoSessionContextValue(
  sessionState: ReturnType<typeof useSdkBackedCryptoSessionState>,
  sessionRestoreSettled: boolean,
  actions: ReturnType<typeof useCryptoAuthActions>,
) {
  const { login, loginWithChallenge, logout } = actions;
  return useMemo<CryptoSessionContextValue>(
    () => ({
      authToken: sessionState.authToken,
      containerId: sessionState.containerId,
      isAuthenticated: sessionState.isAuthenticated,
      login,
      loginWithChallenge,
      logout,
      organizationId: sessionState.organizationId,
      sessionRestoreSettled,
      setContainerId: sessionState.setContainerId,
      setOrganizationId: sessionState.setOrganizationId,
      setUserId: sessionState.setUserId,
      userId: sessionState.userId,
    }),
    [
      login,
      loginWithChallenge,
      logout,
      sessionRestoreSettled,
      sessionState.authToken,
      sessionState.containerId,
      sessionState.isAuthenticated,
      sessionState.organizationId,
      sessionState.setContainerId,
      sessionState.setOrganizationId,
      sessionState.setUserId,
      sessionState.userId,
    ],
  );
}

export function CryptoSessionProvider({ children }: PropsWithChildren) {
  const tearleads = useTearleads();
  const { log, logError } = useLog();
  const hostConfig = useAppHostConfig();
  const {
    client: dbClient,
    ensureIdentityReady: ensureIdentityDatabaseReady,
    status: dbStatus,
  } = useDatabase();
  const { signingFingerprint, signingKeyPair } = useIdentity();
  const localKeyringLock = useLocalKeyringLock();
  const containerBootstrapped = useRef<string | null>(null);
  const sessionState = useSdkBackedCryptoSessionState(tearleads);
  const localSessionPersistence = useLocalCryptoSessionPersistence({
    createLocalKeyring: localKeyringLock.createLocalKeyring,
    namespace: localKeyringLock.isLocked
      ? null
      : (hostConfig.localIdentityNamespace ?? null),
    signingFingerprint,
  });

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
  const checkedPersistedSessionFingerprint = useRestorePersistedSession({
    localPersistence: localSessionPersistence,
    log,
    logError,
    sessionState,
    signingFingerprint,
    tearleads,
  });
  usePersistCryptoSession({
    checkedFingerprint: checkedPersistedSessionFingerprint,
    localPersistence: localSessionPersistence,
    logError,
    sessionState,
    signingFingerprint,
  });
  const sessionRestoreSettled =
    checkedPersistedSessionFingerprint === signingFingerprint;
  const actions = useCryptoAuthActions(tearleads);
  const contextValue = useCryptoSessionContextValue(
    sessionState,
    sessionRestoreSettled,
    actions,
  );

  return (
    <CryptoSessionContext.Provider value={contextValue}>
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
