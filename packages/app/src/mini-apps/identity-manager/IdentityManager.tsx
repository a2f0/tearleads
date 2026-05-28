import type { UserSession } from "@tearleads/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MiniAppButton,
  MiniAppRoot,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../components/shared/MiniAppLayout";
import {
  MiniAppTable,
  MiniAppTableActionButton,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
} from "../../components/shared/MiniAppTable";
import { useWindowRefreshMenuItem } from "../../components/window/WindowMenuContext";
import {
  useBackupKeyPackageAction,
  useRestoreKeyPackageAction,
} from "../../identity/useKeyPackageActions";
import { useRegisterCurrentIdentity } from "../../identity/useRegisterCurrentIdentity";
import { useCryptoSession } from "../../providers/crypto/CryptoSessionProvider";
import { useIdentity } from "../../providers/identity/IdentityProvider";
import { useLog } from "../../providers/logging/LogProvider";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";
import { formatMiniAppDateTime } from "../../utils/formatMiniAppDate";
import "./IdentityManager.css";

const CURRENT_SESSION_MUTATION_ID = "current-session";

const SESSION_TABLE_COLUMNS = [
  { header: "Status", id: "status", width: "6.5rem" },
  { header: "Last Active", id: "last-active", width: "10rem" },
  { header: "Last IP", id: "last-ip", width: "9rem" },
  { header: "IPs", id: "ip-addresses", width: "7rem" },
  { header: "Created", id: "created", width: "10rem" },
  { header: "Signing Key", id: "signing-key" },
  { header: "Session ID", id: "session-id" },
  { header: "", id: "action", width: "7.5rem" },
] satisfies ReadonlyArray<MiniAppTableColumn>;

function compactIdentifier(value: string | null | undefined): string {
  if (!value) {
    return "None";
  }

  if (value.length <= 24) {
    return value;
  }

  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

function IdentityDetail({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd title={value ?? undefined}>{compactIdentifier(value)}</dd>
    </>
  );
}

function getIdentityState({
  signingKeyPair,
  userId,
}: {
  signingKeyPair: unknown;
  userId: string | null;
}): string {
  if (!signingKeyPair) {
    return "No key pair";
  }

  return userId ? "Registered" : "Local only";
}

function getSessionMutationLabel(session: UserSession): string {
  return session.isCurrent ? "Log Out" : "Revoke";
}

function formatSessionIpAddresses(ipAddresses: ReadonlyArray<string>): string {
  if (ipAddresses.length === 0) {
    return "None";
  }
  const [firstIpAddress] = ipAddresses;
  if (ipAddresses.length === 1) {
    return compactIdentifier(firstIpAddress);
  }

  return `${compactIdentifier(firstIpAddress)}, +${ipAddresses.length - 1}`;
}

function sessionIpAddressesTitle(ipAddresses: ReadonlyArray<string>): string {
  return ipAddresses.length === 0 ? "No recorded IPs" : ipAddresses.join(", ");
}

type CryptoSessionContextValue = ReturnType<typeof useCryptoSession>;
type IdentityContextValue = ReturnType<typeof useIdentity>;
type LogContextValue = ReturnType<typeof useLog>;
type SdkClient = ReturnType<typeof useTearleads>;
type IdentityBusyState = "authenticate" | "register" | null;

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
  refreshSessions,
  setSessionError,
  tearleads,
}: {
  clearSessions: () => void;
  log: LogContextValue["log"];
  logError: LogContextValue["logError"];
  logout: CryptoSessionContextValue["logout"];
  refreshSessions: () => Promise<void>;
  setSessionError: (error: string | null) => void;
  tearleads: SdkClient;
}) {
  const [mutatingSessionId, setMutatingSessionId] = useState<string | null>(
    null,
  );

  const logoutCurrentSession = useCallback(async () => {
    setMutatingSessionId(CURRENT_SESSION_MUTATION_ID);
    setSessionError(null);
    try {
      const loggedOut = await tearleads.session.logoutRemote();
      if (!loggedOut) {
        setSessionError("Could not log out remote session.");
        return;
      }

      log("Logged out");
    } catch (error: unknown) {
      logError("Failed to log out", error);
      setSessionError("Could not log out remote session.");
    } finally {
      logout();
      clearSessions();
      setMutatingSessionId(null);
    }
  }, [clearSessions, log, logError, logout, setSessionError, tearleads]);

  const endSession = useCallback(
    async (session: UserSession) => {
      if (session.isCurrent) {
        await logoutCurrentSession();
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
      logoutCurrentSession,
      refreshSessions,
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

  const handleRegisterIdentity = useCallback(async () => {
    setIdentityBusy("register");
    setIdentityError(null);
    try {
      const registered = await registerCurrentIdentity();
      if (!registered) {
        setIdentityError("Could not upload public key.");
      }
    } catch (error: unknown) {
      logError("Failed to upload public key", error);
      setIdentityError("Could not upload public key.");
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

  const destroyKeyPair = useCallback(() => {
    logout();
    destroyKey();
    clearSessions();
    setIdentityError(null);
    clearSessionError();
  }, [clearSessionError, clearSessions, destroyKey, logout]);

  return {
    authenticate,
    destroyKeyPair,
    handleRegisterIdentity,
    identityBusy,
    identityError,
  };
}

function IdentityActionToolbar({
  backupKeyPackage,
  canAuthenticate,
  canExportKeyPackage,
  canRegisterCurrentIdentity,
  generateKey,
  handleAuthenticate,
  handleDestroyKeyPair,
  handleLogoutCurrentSession,
  handleRegisterIdentity,
  handleRestoreKeyPackageClick,
  hasSigningKeyPair,
  identityBusy,
  isAuthenticated,
  mutatingSessionId,
}: {
  backupKeyPackage: () => Promise<void>;
  canAuthenticate: boolean;
  canExportKeyPackage: boolean;
  canRegisterCurrentIdentity: boolean;
  generateKey: () => void;
  handleAuthenticate: () => Promise<void>;
  handleDestroyKeyPair: () => void;
  handleLogoutCurrentSession: () => Promise<void>;
  handleRegisterIdentity: () => Promise<void>;
  handleRestoreKeyPackageClick: () => void;
  hasSigningKeyPair: boolean;
  identityBusy: IdentityBusyState;
  isAuthenticated: boolean;
  mutatingSessionId: string | null;
}) {
  return (
    <MiniAppToolbar wrap>
      {!hasSigningKeyPair && (
        <MiniAppButton onClick={generateKey}>Generate Key Pair</MiniAppButton>
      )}
      {canExportKeyPackage && (
        <MiniAppButton onClick={() => void backupKeyPackage()}>
          Backup Key Package
        </MiniAppButton>
      )}
      <MiniAppButton onClick={handleRestoreKeyPackageClick}>
        Restore Key Package
      </MiniAppButton>
      {canRegisterCurrentIdentity && (
        <MiniAppButton
          disabled={identityBusy !== null}
          onClick={() => void handleRegisterIdentity()}
        >
          Upload Public Key
        </MiniAppButton>
      )}
      {canAuthenticate && (
        <MiniAppButton
          disabled={identityBusy !== null}
          onClick={() => void handleAuthenticate()}
        >
          Authenticate
        </MiniAppButton>
      )}
      {isAuthenticated && (
        <MiniAppButton
          disabled={mutatingSessionId !== null}
          onClick={() => void handleLogoutCurrentSession()}
        >
          Log Out
        </MiniAppButton>
      )}
      {hasSigningKeyPair && (
        <MiniAppButton variant="ghost" onClick={handleDestroyKeyPair}>
          Destroy Key Pair
        </MiniAppButton>
      )}
    </MiniAppToolbar>
  );
}

function IdentitySection({
  actions,
  containerId,
  identityError,
  identityState,
  isAuthenticated,
  organizationId,
  signingFingerprint,
  userId,
}: {
  actions: Parameters<typeof IdentityActionToolbar>[0];
  containerId: string | null;
  identityError: string | null;
  identityState: string;
  isAuthenticated: boolean;
  organizationId: string | null;
  signingFingerprint: string | null;
  userId: string | null;
}) {
  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>Identity</h2>
        <MiniAppStatus as="span">{identityState}</MiniAppStatus>
      </MiniAppSectionHeading>
      {identityError && (
        <MiniAppStatus tone="error">{identityError}</MiniAppStatus>
      )}
      <dl className="identity-manager-details">
        <IdentityDetail label="Signing Key" value={signingFingerprint} />
        <IdentityDetail label="User ID" value={userId} />
        <IdentityDetail label="Organization ID" value={organizationId} />
        <IdentityDetail label="Container ID" value={containerId} />
        <dt>Authentication</dt>
        <dd>{isAuthenticated ? "Authenticated" : "Signed out"}</dd>
      </dl>
      <IdentityActionToolbar {...actions} />
    </MiniAppSection>
  );
}

function SessionTableRow({
  handleEndSession,
  mutatingSessionId,
  session,
}: {
  handleEndSession: (session: UserSession) => Promise<void>;
  mutatingSessionId: string | null;
  session: UserSession;
}) {
  const rowIsMutating =
    mutatingSessionId === session.id ||
    (session.isCurrent && mutatingSessionId === CURRENT_SESSION_MUTATION_ID);

  return (
    <MiniAppTableRow>
      <MiniAppTableCell>
        <MiniAppTableText>
          {session.isCurrent ? "Current" : "Active"}
        </MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableText truncate={false}>
          {formatMiniAppDateTime(session.lastActiveAt)}
        </MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableText title={session.lastActiveIp ?? "No recorded IP"}>
          {session.lastActiveIp ?? "None"}
        </MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableText title={sessionIpAddressesTitle(session.ipAddresses)}>
          {formatSessionIpAddresses(session.ipAddresses)}
        </MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableText truncate={false}>
          {formatMiniAppDateTime(session.createdAt)}
        </MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableText title={session.signingKeyFingerprint}>
          {compactIdentifier(session.signingKeyFingerprint)}
        </MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableText title={session.id}>
          {compactIdentifier(session.id)}
        </MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableActionButton
          disabled={mutatingSessionId !== null}
          onClick={() => void handleEndSession(session)}
        >
          {rowIsMutating ? "Working..." : getSessionMutationLabel(session)}
        </MiniAppTableActionButton>
      </MiniAppTableCell>
    </MiniAppTableRow>
  );
}

function SessionTableBody({
  handleEndSession,
  loadingSessions,
  mutatingSessionId,
  sessions,
}: {
  handleEndSession: (session: UserSession) => Promise<void>;
  loadingSessions: boolean;
  mutatingSessionId: string | null;
  sessions: ReadonlyArray<UserSession>;
}) {
  if (sessions.length === 0) {
    return (
      <MiniAppTableEmptyRow colSpan={SESSION_TABLE_COLUMNS.length}>
        {loadingSessions ? "Loading sessions..." : "No active sessions."}
      </MiniAppTableEmptyRow>
    );
  }

  return sessions.map((session) => (
    <SessionTableRow
      handleEndSession={handleEndSession}
      key={session.id}
      mutatingSessionId={mutatingSessionId}
      session={session}
    />
  ));
}

function SessionsSection({
  canManageSessions,
  handleEndSession,
  loadingSessions,
  mutatingSessionId,
  refreshSessions,
  sessionError,
  sessions,
}: {
  canManageSessions: boolean;
  handleEndSession: (session: UserSession) => Promise<void>;
  loadingSessions: boolean;
  mutatingSessionId: string | null;
  refreshSessions: () => Promise<void>;
  sessionError: string | null;
  sessions: ReadonlyArray<UserSession>;
}) {
  return (
    <MiniAppSection className="identity-manager-sessions">
      <MiniAppSectionHeading>
        <h2>Active Sessions</h2>
        {canManageSessions && (
          <MiniAppButton
            disabled={loadingSessions || mutatingSessionId !== null}
            variant="ghost"
            onClick={() => void refreshSessions()}
          >
            Refresh
          </MiniAppButton>
        )}
      </MiniAppSectionHeading>
      {sessionError && (
        <MiniAppStatus tone="error">{sessionError}</MiniAppStatus>
      )}
      {!canManageSessions ? (
        <MiniAppStatus>Authenticate to manage sessions.</MiniAppStatus>
      ) : (
        <MiniAppTableFrame className="identity-manager-session-table">
          <MiniAppTable columns={SESSION_TABLE_COLUMNS}>
            <SessionTableBody
              handleEndSession={handleEndSession}
              loadingSessions={loadingSessions}
              mutatingSessionId={mutatingSessionId}
              sessions={sessions}
            />
          </MiniAppTable>
        </MiniAppTableFrame>
      )}
    </MiniAppSection>
  );
}

function IdentityManagerLayout({
  backupKeyPackage,
  canAuthenticate,
  canExportKeyPackage,
  canManageSessions,
  handleRestoreFileChange,
  handleRestoreKeyPackageClick,
  identity,
  identityMutations,
  identityState,
  registration,
  restoreFileInputRef,
  session,
  sessionList,
  sessionMutations,
}: {
  backupKeyPackage: () => Promise<void>;
  canAuthenticate: boolean;
  canExportKeyPackage: boolean;
  canManageSessions: boolean;
  handleRestoreFileChange: ReturnType<
    typeof useRestoreKeyPackageAction
  >["handleRestoreFileChange"];
  handleRestoreKeyPackageClick: () => void;
  identity: IdentityContextValue;
  identityMutations: ReturnType<typeof useIdentityManagerIdentityMutations>;
  identityState: string;
  registration: ReturnType<typeof useRegisterCurrentIdentity>;
  restoreFileInputRef: ReturnType<
    typeof useRestoreKeyPackageAction
  >["restoreFileInputRef"];
  session: CryptoSessionContextValue;
  sessionList: ReturnType<typeof useIdentityManagerSessionList>;
  sessionMutations: ReturnType<typeof useIdentityManagerSessionMutations>;
}) {
  return (
    <MiniAppRoot className="identity-manager">
      <input
        ref={restoreFileInputRef}
        aria-label="Identity Manager Restore Key Package File"
        type="file"
        accept="application/json,.json"
        hidden
        onChange={handleRestoreFileChange}
      />
      <main className="identity-manager-main">
        <IdentitySection
          actions={{
            backupKeyPackage,
            canAuthenticate,
            canExportKeyPackage,
            canRegisterCurrentIdentity: registration.canRegisterCurrentIdentity,
            generateKey: identity.generateKey,
            handleAuthenticate: identityMutations.authenticate,
            handleDestroyKeyPair: identityMutations.destroyKeyPair,
            handleLogoutCurrentSession: sessionMutations.logoutCurrentSession,
            handleRegisterIdentity: identityMutations.handleRegisterIdentity,
            handleRestoreKeyPackageClick,
            hasSigningKeyPair: identity.signingKeyPair !== null,
            identityBusy: identityMutations.identityBusy,
            isAuthenticated: session.isAuthenticated,
            mutatingSessionId: sessionMutations.mutatingSessionId,
          }}
          containerId={session.containerId}
          identityError={identityMutations.identityError}
          identityState={identityState}
          isAuthenticated={session.isAuthenticated}
          organizationId={session.organizationId}
          signingFingerprint={identity.signingFingerprint}
          userId={session.userId}
        />
        <SessionsSection
          canManageSessions={canManageSessions}
          handleEndSession={sessionMutations.endSession}
          loadingSessions={sessionList.loadingSessions}
          mutatingSessionId={sessionMutations.mutatingSessionId}
          refreshSessions={sessionList.refreshSessions}
          sessionError={sessionList.sessionError}
          sessions={sessionList.sessions}
        />
      </main>
    </MiniAppRoot>
  );
}

export function IdentityManager() {
  const tearleads = useTearleads();
  const session = useCryptoSession();
  const identity = useIdentity();
  const { log, logError } = useLog();
  const registration = useRegisterCurrentIdentity();
  const backupKeyPackage = useBackupKeyPackageAction();
  const restoreKeyPackage = useRestoreKeyPackageAction();
  const canManageSessions =
    session.isAuthenticated && session.authToken !== null;
  const canExportKeyPackage =
    identity.signingKeyPair !== null && identity.encapsulationKeyPair !== null;
  const canAuthenticate =
    identity.signingKeyPair !== null &&
    session.userId !== null &&
    !session.isAuthenticated;
  const identityState = getIdentityState({
    signingKeyPair: identity.signingKeyPair,
    userId: session.userId,
  });
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
  const sessionMutations = useIdentityManagerSessionMutations({
    clearSessions,
    log,
    logError,
    logout: session.logout,
    refreshSessions: sessionList.refreshSessions,
    setSessionError: sessionList.setSessionError,
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

  return (
    <IdentityManagerLayout
      backupKeyPackage={backupKeyPackage}
      canAuthenticate={canAuthenticate}
      canExportKeyPackage={canExportKeyPackage}
      canManageSessions={canManageSessions}
      handleRestoreFileChange={restoreKeyPackage.handleRestoreFileChange}
      handleRestoreKeyPackageClick={
        restoreKeyPackage.handleRestoreKeyPackageClick
      }
      identity={identity}
      identityMutations={identityMutations}
      identityState={identityState}
      registration={registration}
      restoreFileInputRef={restoreKeyPackage.restoreFileInputRef}
      session={session}
      sessionList={sessionList}
      sessionMutations={sessionMutations}
    />
  );
}
