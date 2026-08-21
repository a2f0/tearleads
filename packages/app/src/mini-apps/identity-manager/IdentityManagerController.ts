import type { UserSession } from "@symcrypt/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type LogoutOptions,
  runConfirmedLogout,
  useLogoutConfirmationDialogState,
} from "../../components/shared/useLogoutConfirmation";
import { useWindowRefreshMenuItem } from "../../components/window/WindowMenuContext";
import { useAuthenticateAction } from "../../identity/useAuthenticateAction";
import {
  type RegisterCurrentIdentityResult,
  useRegisterCurrentIdentity,
} from "../../identity/useRegisterCurrentIdentity";
import {
  type CryptoSessionContextValue,
  useCryptoSession,
} from "../../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../../providers/db/DatabaseProvider";
import {
  type IdentityContextValue,
  useIdentity,
} from "../../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../../providers/local-keyring/LocalKeyringLockProvider";
import { useLog } from "../../providers/logging/LogProvider";
import { useSymCrypt } from "../../providers/sdk/SymCryptProvider";
import { CURRENT_SESSION_MUTATION_ID } from "./IdentityManagerConstants";
import { getIdentityState } from "./IdentityManagerIdentityState";
import { useIdentitySwitcher } from "./switcher/useIdentitySwitcher";
import type { IdentityBusyState } from "./toolbar/IdentityManagerActionToolbar";

type DatabaseContextValue = ReturnType<typeof useDatabase>;
type LogContextValue = ReturnType<typeof useLog>;
type RegistrationResult = RegisterCurrentIdentityResult;
type SdkClient = ReturnType<typeof useSymCrypt>;

function useIdentityManagerSessionList({
  canManageSessions,
  logError,
  symcrypt,
}: {
  canManageSessions: boolean;
  logError: LogContextValue["logError"];
  symcrypt: SdkClient;
}) {
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refreshSessions = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!canManageSessions) {
      setSessions([]);
      setSessionError(null);
      setLoadingSessions(false);
      return;
    }

    setLoadingSessions(true);
    setSessionError(null);
    try {
      const nextSessions = await symcrypt.session.listSessions();
      if (requestIdRef.current === requestId) {
        setSessions(nextSessions);
      }
    } catch (error: unknown) {
      logError("Failed to load sessions", error);
      if (requestIdRef.current === requestId) {
        setSessionError("Could not load active sessions.");
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setLoadingSessions(false);
      }
    }
  }, [canManageSessions, logError, symcrypt]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  return {
    loadingSessions,
    refreshSessions,
    sessionError,
    sessions,
    setSessionError,
    setSessions,
  };
}

function useIdentityManagerSessionMutations({
  clearSessions,
  log,
  logError,
  logout,
  purgeWorker,
  refreshSessions,
  requestCurrentSessionLogout,
  setSessionError,
  signingFingerprint,
  symcrypt,
}: {
  clearSessions: () => void;
  log: LogContextValue["log"];
  logError: LogContextValue["logError"];
  logout: CryptoSessionContextValue["logout"];
  purgeWorker: DatabaseContextValue["purgeWorker"];
  refreshSessions: () => Promise<void>;
  requestCurrentSessionLogout: () => void;
  setSessionError: (error: string | null) => void;
  signingFingerprint: string | null;
  symcrypt: SdkClient;
}) {
  const [mutatingSessionId, setMutatingSessionId] = useState<string | null>(
    null,
  );

  const logoutCurrentSession = useCallback(
    async ({ keepLocalData }: LogoutOptions = { keepLocalData: true }) => {
      setMutatingSessionId(CURRENT_SESSION_MUTATION_ID);
      setSessionError(null);
      try {
        await runConfirmedLogout({
          getSigningFingerprint: () => symcrypt.identity.signingFingerprint,
          keepLocalData,
          log,
          logError,
          logout,
          onAfterLocalLogout: clearSessions,
          onRemoteLogoutFailure: () => {
            setSessionError("Could not log out remote session.");
          },
          purgeWorker,
          session: symcrypt.session,
          signingFingerprint,
        });
      } finally {
        setMutatingSessionId(null);
      }
    },
    [
      clearSessions,
      log,
      logError,
      logout,
      purgeWorker,
      setSessionError,
      signingFingerprint,
      symcrypt,
    ],
  );

  const endSession = useCallback(
    async (session: UserSession) => {
      if (session.isCurrent) {
        // Route the current session's logout through the confirmation dialog
        // (keep-local-data choice) instead of logging out immediately.
        requestCurrentSessionLogout();
        return;
      }

      setMutatingSessionId(session.id);
      setSessionError(null);
      try {
        const destroyed = await symcrypt.session.destroySession(session.id);
        if (!destroyed) {
          setSessionError("Could not revoke session.");
          return;
        }

        log("Session revoked");
        await refreshSessions();
      } catch (error: unknown) {
        logError("Failed to revoke session", error);
        setSessionError("Could not revoke session.");
      } finally {
        setMutatingSessionId(null);
      }
    },
    [
      log,
      logError,
      refreshSessions,
      requestCurrentSessionLogout,
      setSessionError,
      symcrypt,
    ],
  );

  return { endSession, logoutCurrentSession, mutatingSessionId };
}

function useIdentityManagerIdentityMutations({
  clearSessionError,
  clearSessions,
  destroyKey,
  logError,
  logout,
  registerCurrentIdentity,
}: {
  clearSessionError: () => void;
  clearSessions: () => void;
  destroyKey: IdentityContextValue["destroyKey"];
  logError: LogContextValue["logError"];
  logout: CryptoSessionContextValue["logout"];
  registerCurrentIdentity: () => Promise<boolean>;
}) {
  // Authentication (with its network-aware failure reason) is shared with the
  // Org Manager gate; registration stays local to this view. Merge the two into
  // the single busy/error the layout renders.
  // Destructure the stable action fns rather than depending on the hook's
  // result object, whose identity changes every render and would defeat the
  // useCallback memoization below.
  const {
    authenticate: runAuthenticate,
    authenticating,
    clearError: clearAuthError,
    error: authError,
  } = useAuthenticateAction();
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [isDestroyKeyPackageDialogOpen, setDestroyKeyPackageDialogOpen] =
    useState(false);

  // Registration and authentication share one error line, so each clears the
  // other's on start — otherwise a stale "Could not register key." would win the
  // `??` below and mask a later authenticate outcome.
  const handleRegisterIdentity = useCallback(async () => {
    setRegistering(true);
    setRegisterError(null);
    clearAuthError();
    try {
      const registered = await registerCurrentIdentity();
      if (!registered) {
        setRegisterError("Could not register key.");
      }
    } catch (error: unknown) {
      logError("Failed to register key", error);
      setRegisterError("Could not register key.");
    } finally {
      setRegistering(false);
    }
  }, [clearAuthError, logError, registerCurrentIdentity]);

  const authenticate = useCallback(async () => {
    setRegisterError(null);
    await runAuthenticate();
  }, [runAuthenticate]);

  const requestDestroyKeyPackage = useCallback(() => {
    setDestroyKeyPackageDialogOpen(true);
  }, []);

  const closeDestroyKeyPackageDialog = useCallback(() => {
    setDestroyKeyPackageDialogOpen(false);
  }, []);

  const confirmDestroyKeyPackage = useCallback(() => {
    logout();
    destroyKey();
    clearSessions();
    setRegisterError(null);
    clearAuthError();
    clearSessionError();
    setDestroyKeyPackageDialogOpen(false);
  }, [clearAuthError, clearSessionError, clearSessions, destroyKey, logout]);

  const identityBusy: IdentityBusyState = registering
    ? "register"
    : authenticating
      ? "authenticate"
      : null;
  const identityError = registerError ?? authError;

  return {
    authenticate,
    closeDestroyKeyPackageDialog,
    confirmDestroyKeyPackage,
    handleRegisterIdentity,
    identityBusy,
    identityError,
    isDestroyKeyPackageDialogOpen,
    requestDestroyKeyPackage,
  };
}

/**
 * Wire the logout-confirmation dialog to the session mutations: the dialog owns
 * open state, the mutations own the actual logout, and `onConfirmLogout` bridges
 * them (closing the dialog once logout settles).
 */
function useIdentityManagerLogout(input: {
  clearSessions: () => void;
  log: LogContextValue["log"];
  logError: LogContextValue["logError"];
  logout: CryptoSessionContextValue["logout"];
  purgeWorker: DatabaseContextValue["purgeWorker"];
  refreshSessions: () => Promise<void>;
  setSessionError: (error: string | null) => void;
  signingFingerprint: string | null;
  symcrypt: SdkClient;
}) {
  const logoutDialog = useLogoutConfirmationDialogState();
  const sessionMutations = useIdentityManagerSessionMutations({
    ...input,
    requestCurrentSessionLogout: logoutDialog.requestLogout,
  });
  const logoutBusy =
    sessionMutations.mutatingSessionId === CURRENT_SESSION_MUTATION_ID;
  const onConfirmLogout = useCallback(
    (options: LogoutOptions) => {
      void sessionMutations
        .logoutCurrentSession(options)
        .finally(() => logoutDialog.closeLogoutDialog());
    },
    [logoutDialog, sessionMutations],
  );

  return { logoutBusy, logoutDialog, onConfirmLogout, sessionMutations };
}

/** Derive the view's capability flags + identity-state label from context. */
function deriveIdentityManagerStatus(
  session: CryptoSessionContextValue,
  identity: IdentityContextValue,
) {
  return {
    canAuthenticate:
      identity.signingKeyPair !== null && !session.isAuthenticated,
    canManageSessions: session.isAuthenticated && session.authToken !== null,
    identityState: getIdentityState({
      signingKeyPair: identity.signingKeyPair,
      userId: session.userId,
    }),
  };
}

/**
 * Assemble every hook the Identity Manager view needs and return a flat props
 * object for the presentational layout. Kept out of the component file so the
 * view module stays presentational.
 */
export function useIdentityManager() {
  const symcrypt = useSymCrypt();
  const session = useCryptoSession();
  const identity = useIdentity();
  const localKeyringLock = useLocalKeyringLock();
  const { log, logError } = useLog();
  const registration: RegistrationResult = useRegisterCurrentIdentity();
  const { purgeWorker } = useDatabase();
  const { canAuthenticate, canManageSessions, identityState } =
    deriveIdentityManagerStatus(session, identity);
  const sessionList = useIdentityManagerSessionList({
    canManageSessions,
    logError,
    symcrypt,
  });
  const clearSessions = useCallback(
    () => sessionList.setSessions([]),
    [sessionList.setSessions],
  );
  const clearSessionError = useCallback(
    () => sessionList.setSessionError(null),
    [sessionList.setSessionError],
  );
  const { logoutBusy, logoutDialog, onConfirmLogout, sessionMutations } =
    useIdentityManagerLogout({
      clearSessions,
      log,
      logError,
      logout: session.logout,
      purgeWorker,
      refreshSessions: sessionList.refreshSessions,
      setSessionError: sessionList.setSessionError,
      signingFingerprint: identity.signingFingerprint,
      symcrypt,
    });
  const identityMutations = useIdentityManagerIdentityMutations({
    clearSessionError,
    clearSessions,
    destroyKey: identity.destroyKey,
    logError,
    logout: session.logout,
    registerCurrentIdentity: registration.registerCurrentIdentity,
  });
  const switcherBusy =
    logoutDialog.isOpen ||
    logoutBusy ||
    identityMutations.identityBusy !== null;
  const identitySwitcher = useIdentitySwitcher(identity, switcherBusy);
  useWindowRefreshMenuItem(
    canManageSessions
      ? {
          disabled:
            sessionList.loadingSessions ||
            sessionMutations.mutatingSessionId !== null,
          onRefresh: sessionList.refreshSessions,
          refreshing: sessionList.loadingSessions,
        }
      : null,
  );

  return {
    canAuthenticate,
    canManageSessions,
    identity,
    identityMutations,
    identityState,
    identitySwitcher,
    isDestroyKeyPackageDialogOpen:
      identityMutations.isDestroyKeyPackageDialogOpen,
    localKeyringLocked: localKeyringLock.isLocked,
    logoutBusy,
    logoutDialog,
    onConfirmLogout,
    registration,
    session,
    sessionList,
    sessionMutations,
  };
}
