import { type ReactNode, useEffect, useState } from "react";
import { DestroyKeyPackageConfirmationDialog } from "../../components/shared/DestroyKeyPackageConfirmationDialog";
import { LogoutConfirmationDialog } from "../../components/shared/LogoutConfirmationDialog";
import {
  MiniAppClipboardButton,
  MiniAppRoot,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";
import { useAppFeatureFlags } from "../../providers/feature-flags/AppFeatureFlagsProvider";
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
import { SessionsSection } from "./IdentityManagerSessions";
import { IdentitySwitcher } from "./IdentitySwitcher";

type IdentityManagerModel = ReturnType<typeof useIdentityManager>;

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

function IdentitySection({
  actions,
  containerId,
  identityError,
  identityState,
  isAuthenticated,
  organizationId,
  passkeyBackupError,
  passkeyBackupStatus,
  signingFingerprint,
  userId,
}: {
  actions: IdentityActionToolbarProps;
  containerId: string | null;
  identityError: string | null;
  identityState: string;
  isAuthenticated: boolean;
  organizationId: string | null;
  passkeyBackupError: string | null;
  passkeyBackupStatus: string | null;
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
      {passkeyBackupError && (
        <MiniAppStatus tone="error">{passkeyBackupError}</MiniAppStatus>
      )}
      {passkeyBackupStatus && (
        <MiniAppStatus>{passkeyBackupStatus}</MiniAppStatus>
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

function getIdentitySectionActions(
  {
    backupKeyPackage,
    canAuthenticate,
    canExportKeyPackage,
    handleRestoreKeyPackageClick,
    identity,
    identityMutations,
    localKeyringLocked,
    logoutDialog,
    registration,
    session,
    sessionMutations,
  }: IdentityManagerModel,
  passkeysEnabled: boolean,
): IdentityActionToolbarProps {
  return {
    backupKeyPackage,
    canAuthenticate,
    canExportKeyPackage,
    canGenerateKey: !localKeyringLocked,
    canPasskeyBackupKeyPackage:
      passkeysEnabled &&
      identityMutations.passkeyBackupSupported &&
      canExportKeyPackage &&
      session.isAuthenticated,
    canPasskeyRestoreKeyPackage:
      passkeysEnabled &&
      identityMutations.passkeyBackupSupported &&
      !localKeyringLocked,
    canRegisterCurrentIdentity: registration.canRegisterCurrentIdentity,
    canRestoreKeyPackage: !localKeyringLocked,
    generateKey: identity.generateKey,
    handleAuthenticate: identityMutations.authenticate,
    handleDestroyKeyPair: identityMutations.requestDestroyKeyPackage,
    handleLogoutCurrentSession: logoutDialog.requestLogout,
    handlePasskeyBackupKeyPackage:
      identityMutations.handlePasskeyBackupKeyPackage,
    handlePasskeyRestoreKeyPackage:
      identityMutations.handlePasskeyRestoreKeyPackage,
    handleRegisterIdentity: identityMutations.handleRegisterIdentity,
    handleRestoreKeyPackageClick,
    hasSigningKeyPair: identity.signingKeyPair !== null,
    identityBusy: identity.identityTransitionInFlight
      ? "transition"
      : identityMutations.identityBusy,
    isAuthenticated: session.isAuthenticated,
    mutatingSessionId: sessionMutations.mutatingSessionId,
    onPasskeyAuthenticatorAttachmentChange:
      identityMutations.setPasskeyBackupAuthenticatorAttachment,
    passkeyAuthenticatorAttachment:
      identityMutations.passkeyBackupAuthenticatorAttachment,
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
  const { passkeysEnabled } = useAppFeatureFlags();

  return (
    <>
      <IdentitySection
        actions={getIdentitySectionActions(model, passkeysEnabled)}
        containerId={session.containerId}
        identityError={identityMutations.identityError}
        identityState={identityState}
        isAuthenticated={session.isAuthenticated}
        organizationId={session.organizationId}
        passkeyBackupError={identityMutations.passkeyBackupError}
        passkeyBackupStatus={identityMutations.passkeyBackupStatus}
        signingFingerprint={identity.signingFingerprint}
        userId={session.userId}
      />
      <IdentityManagerRecoveryKeySection />
      <IdentityManagerPinCodeSection />
      <SessionsSection
        canManageSessions={canManageSessions}
        handleEndSession={sessionMutations.endSession}
        loadingSessions={sessionList.loadingSessions}
        mutatingSessionId={sessionMutations.mutatingSessionId}
        onOpenSessionDetail={onOpenSessionDetail}
        refreshSessions={sessionList.refreshSessions}
        sessionError={sessionList.sessionError}
        sessions={sessionList.sessions}
      />
    </>
  );
}

function IdentityManagerLayout(model: IdentityManagerModel) {
  const {
    canManageSessions,
    handleRestoreFileChange,
    identityMutations,
    identitySwitcher,
    isDestroyKeyPackageDialogOpen,
    logoutBusy,
    logoutDialog,
    onConfirmLogout,
    restoreFileInputRef,
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
      <input
        ref={restoreFileInputRef}
        aria-label="Identity Manager Restore Key Package File"
        type="file"
        accept="application/json,.json"
        hidden
        onChange={handleRestoreFileChange}
      />
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
