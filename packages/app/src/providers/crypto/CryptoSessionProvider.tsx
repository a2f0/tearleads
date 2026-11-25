import {
  isDatabaseUnavailableError,
  type SessionTwoFactorCode,
} from "@tearleads/client-sdk";
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
import {
  useTearleadsExternalValue,
  useTearleadsStoreSnapshot,
} from "../sdk/useTearleadsSubscription";
import {
  type LocalCryptoSessionPersistence,
  type PersistedCryptoSessionContext,
  restorePersistedCryptoSession,
  useLocalCryptoSessionPersistence,
} from "./localCryptoSessionPersistence";
import { useEnsureDatabaseForIdentity } from "./useEnsureDatabaseForIdentity";
import { usePersistCryptoSession } from "./usePersistCryptoSession";
import {
  type RestoreReloadDrop,
  usePrepareForRestoreReload,
} from "./usePrepareForRestoreReload";

export interface CryptoSessionContextValue {
  userId: string | null;
  organizationId: string | null;
  containerId: string | null;
  authToken: string | null;
  isAuthenticated: boolean;
  /**
   * Platform-operator flag the server reported at login. It only decides
   * whether the root console is offered; the API enforces root access itself.
   */
  isRoot: boolean;
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
  /** Signs in with the code an identity with two-factor on was asked for. */
  loginWithSecondFactor: (twoFactor: SessionTwoFactorCode) => Promise<boolean>;
  logout: () => void;
  /**
   * Leaves a signed-out record that keeps this identity's root
   * acknowledgements, before a backup restore reloads the app. Resolves with
   * why the record was dropped instead, or null.
   */
  prepareForRestoreReload: () => Promise<RestoreReloadDrop>;
}

const CryptoSessionContext = createContext<CryptoSessionContextValue | null>(
  null,
);

interface RootBootstrapAttempt {
  readonly signIn: () => boolean;
  readonly scope: ReturnType<typeof useTearleads>["domainScope"];
  readonly dbClient: ReturnType<typeof useDatabase>["client"];
  readonly signingFingerprint: string;
}

function useResetCryptoSession(
  containerBootstrapped: MutableRefObject<RootBootstrapAttempt | null>,
  signingKeyPair: ReturnType<typeof useIdentity>["signingKeyPair"],
  resetSession: () => void,
) {
  useEffect(() => {
    if (signingKeyPair) {
      return;
    }

    containerBootstrapped.current = null;
    resetSession();
  }, [containerBootstrapped, resetSession, signingKeyPair]);
}

function useBootstrapCryptoSessionContainer(
  containerBootstrapped: MutableRefObject<RootBootstrapAttempt | null>,
  tearleads: ReturnType<typeof useTearleads>,
  containerId: string | null,
  signingFingerprint: string | null,
  dbStatus: ReturnType<typeof useDatabase>["status"],
  dbClient: ReturnType<typeof useDatabase>["client"],
  logError: (message: string, error: unknown) => void,
) {
  const scope = tearleads.domainScope;
  const signIn = tearleads.session.captureSignIn();
  useEffect(() => {
    const previous = containerBootstrapped.current;
    if (
      containerId !== null ||
      !signingFingerprint ||
      dbStatus !== "ready" ||
      !dbClient ||
      (previous?.scope === scope &&
        previous.signIn() &&
        previous?.dbClient === dbClient &&
        previous.signingFingerprint === signingFingerprint)
    )
      return;
    const attempt = { scope, dbClient, signingFingerprint, signIn };
    containerBootstrapped.current = attempt;
    const current = () =>
      containerBootstrapped.current === attempt &&
      tearleads.domainScope === scope &&
      signIn();
    void (async () => {
      try {
        await tearleads.session.bootstrapLocalRootContainer(current);
      } catch (error: unknown) {
        if (!current()) return;
        containerBootstrapped.current = null;
        // Reloads and identity transitions retire the worker beneath pending
        // queries. The next ready client retries; real SQL failures still log.
        if (!isDatabaseUnavailableError(error)) {
          logError("Failed to bootstrap root container", error);
        }
      }
    })();
  }, [
    containerBootstrapped,
    dbStatus,
    dbClient,
    containerId,
    logError,
    scope,
    signIn,
    signingFingerprint,
    tearleads,
  ]);
}

function useCryptoAuthActions(tearleads: ReturnType<typeof useTearleads>) {
  const logout = useCallback(() => {
    tearleads.session.logout();
  }, [tearleads]);

  const authenticate = useCallback(
    async (
      challengeHex?: string,
      twoFactor?: SessionTwoFactorCode,
    ): Promise<boolean> => {
      if (!tearleads.identity.signingKeyPair) {
        return false;
      }

      return tearleads.session.login(challengeHex, twoFactor);
    },
    [tearleads],
  );
  const login = useCallback(() => authenticate(), [authenticate]);
  const loginWithSecondFactor = useCallback(
    (twoFactor: SessionTwoFactorCode) => authenticate(undefined, twoFactor),
    [authenticate],
  );

  return useMemo(
    () => ({
      login,
      loginWithChallenge: authenticate,
      loginWithSecondFactor,
      logout,
    }),
    [authenticate, login, loginWithSecondFactor, logout],
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
    const sameSignIn = tearleads.session.captureSignIn("restore");
    void restorePersistedCryptoSession({
      isCurrent: () =>
        !cancelled &&
        sameSignIn() &&
        tearleads.identity.signingFingerprint === signingFingerprint,
      localPersistence,
      signingFingerprint,
    })
      .then((persistedSession) => {
        if (
          cancelled ||
          tearleads.session.authToken !== authToken ||
          tearleads.identity.signingFingerprint !== signingFingerprint
        ) {
          clearInFlightFingerprint();
          return;
        }
        clearInFlightFingerprint();
        // Apply the restored session before marking the restore settled so a
        // consumer reacting to `sessionRestoreSettled` already sees the restored
        // userId (and does not, e.g., auto-register over a live session).
        if (persistedSession && sameSignIn()) {
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
    log,
    logError,
    signingFingerprint,
    tearleads,
  ]);

  return checkedFingerprint;
}

function useSdkBackedCryptoSessionState(
  tearleads: ReturnType<typeof useTearleads>,
) {
  const snapshot = useTearleadsStoreSnapshot(tearleads.session);
  // Acknowledgment is derived from the SDK's fingerprint binding, not stored in
  // the snapshot, so it is read through the same subscription.
  const userIdAcknowledged = useTearleadsExternalValue(
    tearleads.session.subscribe,
    () => tearleads.session.userIdAcknowledged,
  );
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
      isRoot: false,
      organizationId: null,
      twoFactorDeviceToken: null,
      userId: null,
    });
  }, [tearleads]);

  return {
    authToken: snapshot.authToken,
    containerId: snapshot.containerId,
    defaultOrganizationId: snapshot.defaultOrganizationId,
    isAuthenticated: snapshot.isAuthenticated,
    isRoot: snapshot.isRoot,
    organizationId: snapshot.organizationId,
    rootAcknowledgments: snapshot.rootAcknowledgments,
    resetSession,
    setContainerId,
    setOrganizationId,
    setUserId,
    twoFactorDeviceToken: snapshot.twoFactorDeviceToken,
    userId: snapshot.userId,
    userIdAcknowledged,
  };
}

function useCryptoSessionContextValue(
  sessionState: ReturnType<typeof useSdkBackedCryptoSessionState>,
  sessionRestoreSettled: boolean,
  actions: ReturnType<typeof useCryptoAuthActions>,
  prepareForRestoreReload: () => Promise<RestoreReloadDrop>,
) {
  const { login, loginWithChallenge, loginWithSecondFactor, logout } = actions;
  return useMemo<CryptoSessionContextValue>(
    () => ({
      authToken: sessionState.authToken,
      containerId: sessionState.containerId,
      isAuthenticated: sessionState.isAuthenticated,
      isRoot: sessionState.isRoot,
      login,
      loginWithChallenge,
      loginWithSecondFactor,
      logout,
      prepareForRestoreReload,
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
      loginWithSecondFactor,
      logout,
      prepareForRestoreReload,
      sessionRestoreSettled,
      sessionState.authToken,
      sessionState.containerId,
      sessionState.isAuthenticated,
      sessionState.isRoot,
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
  const containerBootstrapped = useRef<RootBootstrapAttempt | null>(null);
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
  const prepareForRestoreReload = usePrepareForRestoreReload({
    localPersistence: localSessionPersistence,
    restoreSettled: sessionRestoreSettled,
    sessionState,
    signingFingerprint,
  });
  const contextValue = useCryptoSessionContextValue(
    sessionState,
    sessionRestoreSettled,
    actions,
    prepareForRestoreReload,
  );

  return (
    <CryptoSessionContext.Provider value={contextValue}>
      {children}
    </CryptoSessionContext.Provider>
  );
}

/** Display preferences can render before a pane provides a session. */
export function useIsRootSession(): boolean {
  return useContext(CryptoSessionContext)?.isRoot ?? false;
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
