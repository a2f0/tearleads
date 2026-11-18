import type { UserSession } from "@tearleads/client-sdk";
import { useWindowRefreshMenuItem } from "@tearleads/windowing";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type LogoutOptions,
  runConfirmedLogout,
  useLogoutConfirmationDialogState,
} from "../../components/shared/useLogoutConfirmation";
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
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import { useIdentityManagerIdentityMutations } from "./actions/useIdentityManagerIdentityMutations";
import { CURRENT_SESSION_MUTATION_ID } from "./IdentityManagerConstants";
import { getIdentityState } from "./IdentityManagerIdentityState";
import { useIdentitySwitcher } from "./switcher/useIdentitySwitcher";

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
  const scope = useTearleadsRuntime().state.domainScope;
  const [list, setList] = useState<{
    scope: typeof scope;
    rows: UserSession[];
  }>({ scope, rows: [] });
  const setSessions = useCallback(
    (rows: UserSession[]) => {
      if (tearleads.domainScope === scope) setList({ scope, rows });
    },
    [scope, tearleads],
  );
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refreshSessions = useCallback(async () => {
    if (scope !== tearleads.domainScope) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const current = () =>
      requestIdRef.current === requestId && scope === tearleads.domainScope;

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
      if (current()) {
        setSessions(nextSessions);
      }
    } catch (error: unknown) {
      if (current()) {
        logError("Failed to load sessions", error);
        setSessionError("Could not load active sessions.");
      }
    } finally {
      if (current()) {
        setLoadingSessions(false);
      }
    }
  }, [canManageSessions, logError, scope, setSessions, tearleads]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  return {
    loadingSessions,
    refreshSessions,
    sessionError,
    sessions: list.scope === scope ? list.rows : [],
    setSessionError,
    setSessions,
  };
}

function useIdentityManagerSessionMutations({
  clearSessions,
  log,
  logError,
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
  purgeWorker: DatabaseContextValue["purgeWorker"];
  refreshSessions: () => Promise<void>;
  requestCurrentSessionLogout: () => void;
  setSessionError: (error: string | null) => void;
  signingFingerprint: string | null;
  tearleads: SdkClient;
}) {
  const scope = useTearleadsRuntime().state.domainScope;
  const [mutation, setMutation] = useState<{
    scope: typeof scope;
    id: string;
  } | null>(null);
  const mutatingSessionId = mutation?.scope === scope ? mutation.id : null;
  const finishMutation = useCallback(
    () => setMutation((active) => (active?.scope === scope ? null : active)),
    [scope],
  );

  const logoutCurrentSession = useCallback(
    async ({ keepLocalData }: LogoutOptions = { keepLocalData: true }) => {
      if (tearleads.domainScope !== scope) return;
      setMutation({ scope, id: CURRENT_SESSION_MUTATION_ID });
      setSessionError(null);
      try {
        await runConfirmedLogout({
          getSigningFingerprint: () => tearleads.identity.signingFingerprint,
          keepLocalData,
          log,
          logError,
          onAfterLocalLogout: clearSessions,
          onRemoteLogoutFailure: () => {
            setSessionError("Could not log out remote session.");
          },
          purgeWorker,
          session: tearleads.session,
          signingFingerprint,
        });
      } finally {
        finishMutation();
      }
    },
    [
      clearSessions,
      scope,
      finishMutation,
      log,
      logError,
      purgeWorker,
      setSessionError,
      signingFingerprint,
      tearleads,
    ],
  );

  const endSession = useCallback(
    async (session: UserSession) => {
      if (tearleads.domainScope !== scope) return;
      if (session.isCurrent) {
        // Route the current session's logout through the confirmation dialog
        // (keep-local-data choice) instead of logging out immediately.
        requestCurrentSessionLogout();
        return;
      }

      setMutation({ scope, id: session.id });
      setSessionError(null);
      try {
        const destroyed = await tearleads.session.destroySession(session.id);
        if (tearleads.domainScope !== scope) return;
        if (!destroyed) {
          setSessionError("Could not revoke session.");
          return;
        }

        log("Session revoked");
        await refreshSessions();
      } catch (error: unknown) {
        if (tearleads.domainScope !== scope) return;
        logError("Failed to revoke session", error);
        setSessionError("Could not revoke session.");
      } finally {
        finishMutation();
      }
    },
    [
      log,
      logError,
      refreshSessions,
      requestCurrentSessionLogout,
      scope,
      finishMutation,
      setSessionError,
      tearleads,
    ],
  );

  return { endSession, logoutCurrentSession, mutatingSessionId };
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
  purgeWorker: DatabaseContextValue["purgeWorker"];
  refreshSessions: () => Promise<void>;
  setSessionError: (error: string | null) => void;
  signingFingerprint: string | null;
  tearleads: SdkClient;
}) {
  const scope = input.tearleads.domainScope;
  const logoutDialog = useLogoutConfirmationDialogState(scope);
  const sessionMutations = useIdentityManagerSessionMutations({
    ...input,
    requestCurrentSessionLogout: logoutDialog.requestLogout,
  });
  const logoutBusy =
    sessionMutations.mutatingSessionId === CURRENT_SESSION_MUTATION_ID;
  const onConfirmLogout = useCallback(
    (options: LogoutOptions) => {
      if (!logoutDialog.isOpen || input.tearleads.domainScope !== scope) return;
      void sessionMutations
        .logoutCurrentSession(options)
        .finally(() => logoutDialog.closeLogoutDialog());
    },
    [input.tearleads, logoutDialog, scope, sessionMutations],
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
  const tearleads = useTearleads();
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
    signingFingerprint: identity.signingFingerprint,
    registerCurrentIdentity: registration.registerCurrentIdentity,
  });
  const switcherBusy =
    logoutDialog.isOpen ||
    identityMutations.isDestroyKeyPackageDialogOpen ||
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
