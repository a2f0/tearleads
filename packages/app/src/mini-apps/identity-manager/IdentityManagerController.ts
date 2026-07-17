import type { UserSession } from "@tearleads/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type LogoutOptions,
  runConfirmedLogout,
  useLogoutConfirmationDialogState,
} from "../../components/shared/useLogoutConfirmation";
import {
  useBackupKeyPackageAction,
  useRestoreKeyPackageAction,
} from "../../identity/useKeyPackageActions";
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
import { useTearleads } from "../../providers/sdk/TearleadsProvider";
import type { IdentityBusyState } from "./IdentityManagerActionToolbar";
import { CURRENT_SESSION_MUTATION_ID } from "./IdentityManagerConstants";
import { getIdentityState } from "./IdentityManagerIdentityState";
import { useIdentityManagerRefreshMenu } from "./IdentityManagerRefreshMenu";
import { useIdentitySwitcher } from "./useIdentitySwitcher";

type DatabaseContextValue = ReturnType<typeof useDatabase>;
type LogContextValue = ReturnType<typeof useLog>;
type RegistrationResult = RegisterCurrentIdentityResult;
type SdkClient = ReturnType<typeof useTearleads>;

function useIdentityManagerSessionList({
  canManageSessions,
  logError,
  tearleads,
}: {
  canManageSessions: boolean;
  logError: LogContextValue["logError"];
  tearleads: SdkClient;
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
      const nextSessions = await tearleads.session.listSessions();
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
  }, [canManageSessions, logError, tearleads]);

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
  tearleads,
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
  tearleads: SdkClient;
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
          getSigningFingerprint: () => tearleads.identity.signingFingerprint,
          keepLocalData,
          log,
          logError,
          logout,
          onAfterLocalLogout: clearSessions,
          onRemoteLogoutFailure: () => {
            setSessionError("Could not log out remote session.");
          },
          purgeWorker,
          session: tearleads.session,
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
      tearleads,
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
        const destroyed = await tearleads.session.destroySession(session.id);
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
      tearleads,
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
  login,
  registerCurrentIdentity,
}: {
  clearSessionError: () => void;
  clearSessions: () => void;
  destroyKey: IdentityContextValue["destroyKey"];
  logError: LogContextValue["logError"];
  logout: CryptoSessionContextValue["logout"];
  login: CryptoSessionContextValue["login"];
  registerCurrentIdentity: () => Promise<boolean>;
}) {
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [identityBusy, setIdentityBusy] = useState<IdentityBusyState>(null);
  const [isDestroyKeyPackageDialogOpen, setDestroyKeyPackageDialogOpen] =
    useState(false);

  const handleRegisterIdentity = useCallback(async () => {
    setIdentityBusy("register");
    setIdentityError(null);
    try {
      const registered = await registerCurrentIdentity();
      if (!registered) {
        setIdentityError("Could not register key.");
      }
    } catch (error: unknown) {
      logError("Failed to register key", error);
      setIdentityError("Could not register key.");
    } finally {
      setIdentityBusy(null);
    }
  }, [logError, registerCurrentIdentity]);

  const authenticate = useCallback(async () => {
    setIdentityBusy("authenticate");
    setIdentityError(null);
    try {
      const authenticated = await login();
      if (!authenticated) {
        setIdentityError("Authentication failed.");
      }
    } catch (error: unknown) {
      logError("Authentication failed", error);
      setIdentityError("Authentication failed.");
    } finally {
      setIdentityBusy(null);
    }
  }, [logError, login]);

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
    setIdentityError(null);
    clearSessionError();
    setDestroyKeyPackageDialogOpen(false);
  }, [clearSessionError, clearSessions, destroyKey, logout]);

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
  tearleads: SdkClient;
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
      identity.signingKeyPair !== null &&
      session.userId !== null &&
      !session.isAuthenticated,
    canExportKeyPackage:
      identity.signingKeyPair !== null &&
      identity.encapsulationKeyPair !== null,
    canManageSessions: session.isAuthenticated && session.authToken !== null,
    identityState: getIdentityState({
      signingKeyPair: identity.signingKeyPair,
      userId: session.userId,
    }),
  };
}

function useIdentityManagerBackupRestoreActions() {
  const backupKeyPackage = useBackupKeyPackageAction();
  const restoreKeyPackage = useRestoreKeyPackageAction();

  return {
    backupKeyPackage,
    handleRestoreFileChange: restoreKeyPackage.handleRestoreFileChange,
    handleRestoreKeyPackageClick:
      restoreKeyPackage.handleRestoreKeyPackageClick,
    restoreFileInputRef: restoreKeyPackage.restoreFileInputRef,
  };
}

/**
 * Assemble every hook the Identity Manager view needs and return a flat props
 * object for the presentational layout. Kept out of the component file so the
 * view module stays presentational.
 */
export function useIdentityManager() {
  const tearleads = useTearleads();
  const session = useCryptoSession();
  const identity = useIdentity();
  const localKeyringLock = useLocalKeyringLock();
  const { log, logError } = useLog();
  const registration: RegistrationResult = useRegisterCurrentIdentity();
  const backupRestoreActions = useIdentityManagerBackupRestoreActions();
  const { purgeWorker } = useDatabase();
  const {
    canAuthenticate,
    canExportKeyPackage,
    canManageSessions,
    identityState,
  } = deriveIdentityManagerStatus(session, identity);
  const sessionList = useIdentityManagerSessionList({
    canManageSessions,
    logError,
    tearleads,
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
      tearleads,
    });
  const identityMutations = useIdentityManagerIdentityMutations({
    clearSessionError,
    clearSessions,
    destroyKey: identity.destroyKey,
    logError,
    logout: session.logout,
    login: session.login,
    registerCurrentIdentity: registration.registerCurrentIdentity,
  });
  const switcherBusy =
    logoutDialog.isOpen ||
    logoutBusy ||
    identityMutations.identityBusy !== null;
  const identitySwitcher = useIdentitySwitcher(identity, switcherBusy);
  useIdentityManagerRefreshMenu({
    canManageSessions,
    loadingSessions: sessionList.loadingSessions,
    mutatingSessionId: sessionMutations.mutatingSessionId,
    refreshSessions: sessionList.refreshSessions,
  });

  return {
    ...backupRestoreActions,
    canAuthenticate,
    canExportKeyPackage,
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
