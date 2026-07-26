import { type ReactNode, useEffect, useState } from "react";
import {
  MiniAppClipboardButton,
  MiniAppRoot,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../components/mini-app/MiniAppLayout";
import { DestroyKeyPackageConfirmationDialog } from "../../components/shared/DestroyKeyPackageConfirmationDialog";
import { LogoutConfirmationDialog } from "../../components/shared/LogoutConfirmationDialog";
import "./IdentityManager.css";
import { IdentityManagerActionsMenu } from "./IdentityManagerActionsMenu";
import {
  IdentityActionToolbar,
  type IdentityActionToolbarProps,
} from "./IdentityManagerActionToolbar";
import { useIdentityManager } from "./IdentityManagerController";
import { IdentityManagerPinCodeSection } from "./IdentityManagerPinCodeSection";
import { IdentityManagerRecoveryKeySection } from "./IdentityManagerRecoveryKeySection";
import { SessionDetailSection } from "./IdentityManagerSessionDetail";
import { compactIdentifier } from "./IdentityManagerSessionDisplay";
import { SessionsSection } from "./IdentityManagerSessions";
import { IdentitySwitcher } from "./IdentitySwitcher";

type IdentityManagerModel = ReturnType<typeof useIdentityManager>;

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
        <div className="identity-manager-identity-heading-meta">
          <MiniAppStatus as="span">{identityState}</MiniAppStatus>
          <IdentityManagerActionsMenu
            disabled={
              actions.identityBusy !== null ||
              actions.mutatingSessionId !== null
            }
            isAuthenticated={actions.isAuthenticated}
            onLogout={actions.handleLogoutCurrentSession}
          />
        </div>
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

function getIdentitySectionActions({
  canAuthenticate,
  identity,
  identityMutations,
  localKeyringLocked,
  logoutDialog,
  registration,
  session,
  sessionMutations,
}: IdentityManagerModel): IdentityActionToolbarProps {
  return {
    canAuthenticate,
    canGenerateKey: !localKeyringLocked,
    canRegisterCurrentIdentity: registration.canRegisterCurrentIdentity,
    generateKey: identity.generateKey,
    handleAuthenticate: identityMutations.authenticate,
    handleDestroyKeyPair: identityMutations.requestDestroyKeyPackage,
    handleLogoutCurrentSession: logoutDialog.requestLogout,
    handleRegisterIdentity: identityMutations.handleRegisterIdentity,
    hasSigningKeyPair: identity.signingKeyPair !== null,
    identityBusy: identity.identityTransitionInFlight
      ? "transition"
      : identityMutations.identityBusy,
    isAuthenticated: session.isAuthenticated,
    mutatingSessionId: sessionMutations.mutatingSessionId,
  };
}

function IdentityManagerPrimaryScreen({
  model,
  onOpenSessionDetail,
}: {
  model: IdentityManagerModel;
  onOpenSessionDetail: (sessionId: string) => void;
}) {
  const {
    canManageSessions,
    identity,
    identityMutations,
    identityState,
    session,
    sessionList,
    sessionMutations,
  } = model;

  return (
    <>
      <IdentitySection
        actions={getIdentitySectionActions(model)}
        containerId={session.containerId}
        identityError={identityMutations.identityError}
        identityState={identityState}
        isAuthenticated={session.isAuthenticated}
        organizationId={session.organizationId}
        signingFingerprint={identity.signingFingerprint}
        userId={session.userId}
      />
      <IdentityManagerRecoveryKeySection />
      <IdentityManagerPinCodeSection />
      {/* Sessions are a server-side concept, so a logged-out identity has no
          section to show — omit it rather than render an empty one. */}
      {canManageSessions ? (
        <SessionsSection
          handleEndSession={sessionMutations.endSession}
          loadingSessions={sessionList.loadingSessions}
          mutatingSessionId={sessionMutations.mutatingSessionId}
          onOpenSessionDetail={onOpenSessionDetail}
          refreshSessions={sessionList.refreshSessions}
          sessionError={sessionList.sessionError}
          sessions={sessionList.sessions}
        />
      ) : null}
    </>
  );
}

function IdentityManagerLayout(model: IdentityManagerModel) {
  const {
    canManageSessions,
    identityMutations,
    identitySwitcher,
    isDestroyKeyPackageDialogOpen,
    logoutBusy,
    logoutDialog,
    onConfirmLogout,
    sessionList,
    sessionMutations,
  } = model;
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const selectedSession =
    sessionList.sessions.find(
      (candidate) => candidate.id === selectedSessionId,
    ) ?? null;
  const hasSelectedSession = selectedSession !== null;

  useEffect(() => {
    if (
      selectedSessionId !== null &&
      (!canManageSessions || !hasSelectedSession)
    ) {
      setSelectedSessionId(null);
    }
  }, [canManageSessions, hasSelectedSession, selectedSessionId]);

  return (
    <MiniAppRoot className="identity-manager">
      <IdentitySwitcher switcher={identitySwitcher} />
      <main className="identity-manager-main">
        {canManageSessions && selectedSession ? (
          <SessionDetailSection
            handleEndSession={sessionMutations.endSession}
            mutatingSessionId={sessionMutations.mutatingSessionId}
            onBack={() => setSelectedSessionId(null)}
            session={selectedSession}
          />
        ) : (
          <IdentityManagerPrimaryScreen
            model={model}
            onOpenSessionDetail={setSelectedSessionId}
          />
        )}
      </main>
      {isDestroyKeyPackageDialogOpen && (
        <DestroyKeyPackageConfirmationDialog
          isOpen={isDestroyKeyPackageDialogOpen}
          onCancel={identityMutations.closeDestroyKeyPackageDialog}
          onConfirm={identityMutations.confirmDestroyKeyPackage}
        />
      )}
      {logoutDialog.isOpen && (
        // Mount only while open so the dialog's keep-local-data checkbox resets
        // to its safe default (checked) on every open — a cancelled "wipe"
        // choice must not silently persist into the next logout.
        <LogoutConfirmationDialog
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
