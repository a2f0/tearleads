import type { ReactNode } from "react";
import { DestroyKeyPackageConfirmationDialog } from "../../components/shared/DestroyKeyPackageConfirmationDialog";
import { LogoutConfirmationDialog } from "../../components/shared/LogoutConfirmationDialog";
import {
  MiniAppClipboardButton,
  MiniAppRoot,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";
import "./IdentityManager.css";
import {
  IdentityActionToolbar,
  type IdentityActionToolbarProps,
} from "./IdentityManagerActionToolbar";
import { useIdentityManager } from "./IdentityManagerController";
import { IdentityManagerPinCodeSection } from "./IdentityManagerPinCodeSection";
import { SessionsSection } from "./IdentityManagerSessions";

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
  isDestroyKeyPackageDialogOpen,
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
            handleDestroyKeyPair: identityMutations.requestDestroyKeyPackage,
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
