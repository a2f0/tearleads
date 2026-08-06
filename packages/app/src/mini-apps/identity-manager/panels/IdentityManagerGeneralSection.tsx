import type { ReactNode } from "react";
import {
  MiniAppClipboardButton,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import type { useIdentityManager } from "../IdentityManagerController";
import { IdentityManagerActionsMenu } from "../menu/IdentityManagerActionsMenu";
import { compactIdentifier } from "../sessions/IdentityManagerSessionDisplay";
import {
  IdentityActionToolbar,
  type IdentityActionToolbarProps,
} from "../toolbar/IdentityManagerActionToolbar";

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

export function IdentityManagerGeneralSection({
  model,
}: {
  model: IdentityManagerModel;
}) {
  const { identity, identityMutations, identityState, session } = model;
  const actions = getIdentitySectionActions(model);

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
      {identityMutations.identityError && (
        <MiniAppStatus tone="error">
          {identityMutations.identityError}
        </MiniAppStatus>
      )}
      <dl className="identity-manager-details">
        <IdentityDetail
          label="Signing Key"
          value={identity.signingFingerprint}
        />
        <IdentityDetail
          action={
            <MiniAppClipboardButton
              label="Copy user ID"
              value={session.userId}
            />
          }
          label="User ID"
          value={session.userId}
        />
        <IdentityDetail
          label="Organization ID"
          value={session.organizationId}
        />
        <IdentityDetail label="Container ID" value={session.containerId} />
        <dt>Authentication</dt>
        <dd>{session.isAuthenticated ? "Authenticated" : "Signed out"}</dd>
      </dl>
      <IdentityActionToolbar {...actions} />
    </MiniAppSection>
  );
}
