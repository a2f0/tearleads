import type { UserSession } from "@tearleads/client-sdk";
import type { ReactNode } from "react";
import {
  MiniAppButton,
  MiniAppClipboardButton,
  MiniAppRoot,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
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
import {
  getMiniAppVirtualFrameStyle,
  MINI_APP_VIRTUAL_TABLE_ROW_HEIGHT,
  MiniAppVirtualTableSpacerRow,
  useMiniAppVirtualRows,
} from "../../components/shared/MiniAppVirtual";
import { formatMiniAppDateTime } from "../../utils/formatMiniAppDate";
import "./IdentityManager.css";
import {
  IdentityActionToolbar,
  type IdentityActionToolbarProps,
} from "./IdentityManagerActionToolbar";
import { CURRENT_SESSION_MUTATION_ID } from "./IdentityManagerConstants";
import { useIdentityManager } from "./IdentityManagerController";
import { IdentityManagerLogoutDialog } from "./IdentityManagerLogoutDialog";
import { IdentityManagerPinCodeSection } from "./IdentityManagerPinCodeSection";

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
  action,
  label,
  value,
}: {
  action?: ReactNode | undefined;
  label: string;
  value: string | null;
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <span
          className="identity-manager-detail-text"
          title={value ?? undefined}
        >
          {compactIdentifier(value)}
        </span>
        {action}
      </dd>
    </>
  );
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
  actions: IdentityActionToolbarProps;
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
        <IdentityDetail
          action={
            <MiniAppClipboardButton label="Copy user ID" value={userId} />
          }
          label="User ID"
          value={userId}
        />
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
  bottomPadding,
  handleEndSession,
  loadingSessions,
  mutatingSessionId,
  sessionCount,
  sessions,
  topPadding,
}: {
  bottomPadding: number;
  handleEndSession: (session: UserSession) => Promise<void>;
  loadingSessions: boolean;
  mutatingSessionId: string | null;
  sessionCount: number;
  sessions: ReadonlyArray<UserSession>;
  topPadding: number;
}) {
  if (sessionCount === 0) {
    return (
      <MiniAppTableEmptyRow colSpan={SESSION_TABLE_COLUMNS.length}>
        {loadingSessions ? "Loading sessions..." : "No active sessions."}
      </MiniAppTableEmptyRow>
    );
  }

  return (
    <>
      <MiniAppVirtualTableSpacerRow
        colSpan={SESSION_TABLE_COLUMNS.length}
        height={topPadding}
      />
      {sessions.map((session) => (
        <SessionTableRow
          handleEndSession={handleEndSession}
          key={session.id}
          mutatingSessionId={mutatingSessionId}
          session={session}
        />
      ))}
      <MiniAppVirtualTableSpacerRow
        colSpan={SESSION_TABLE_COLUMNS.length}
        height={bottomPadding}
      />
    </>
  );
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
  const virtualSessions = useMiniAppVirtualRows({
    rowHeight: MINI_APP_VIRTUAL_TABLE_ROW_HEIGHT,
    rows: sessions,
  });

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
        <MiniAppStatus>Login to manage sessions.</MiniAppStatus>
      ) : (
        <MiniAppTableFrame
          className="identity-manager-session-table mini-app-table-frame--virtual"
          ref={virtualSessions.frameRef}
          style={getMiniAppVirtualFrameStyle(MINI_APP_VIRTUAL_TABLE_ROW_HEIGHT)}
        >
          <MiniAppTable columns={SESSION_TABLE_COLUMNS}>
            <SessionTableBody
              bottomPadding={virtualSessions.bottomPadding}
              handleEndSession={handleEndSession}
              loadingSessions={loadingSessions}
              mutatingSessionId={mutatingSessionId}
              sessionCount={sessions.length}
              sessions={virtualSessions.rows}
              topPadding={virtualSessions.topPadding}
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
  localKeyringLocked,
  logoutBusy,
  logoutDialog,
  onConfirmLogout,
  registration,
  restoreFileInputRef,
  session,
  sessionList,
  sessionMutations,
}: ReturnType<typeof useIdentityManager>) {
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
            canGenerateKey: !localKeyringLocked,
            canRegisterCurrentIdentity: registration.canRegisterCurrentIdentity,
            canRestoreKeyPackage: !localKeyringLocked,
            generateKey: identity.generateKey,
            handleAuthenticate: identityMutations.authenticate,
            handleDestroyKeyPair: identityMutations.destroyKeyPair,
            handleLogoutCurrentSession: logoutDialog.requestLogout,
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
        <IdentityManagerPinCodeSection />
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
      {logoutDialog.isOpen && (
        // Mount only while open so the dialog's keep-local-data checkbox resets
        // to its safe default (checked) on every open — a cancelled "wipe"
        // choice must not silently persist into the next logout.
        <IdentityManagerLogoutDialog
          busy={logoutBusy}
          isOpen={logoutDialog.isOpen}
          onCancel={logoutDialog.closeLogoutDialog}
          onConfirm={onConfirmLogout}
        />
      )}
    </MiniAppRoot>
  );
}

export function IdentityManager() {
  return <IdentityManagerLayout {...useIdentityManager()} />;
}
