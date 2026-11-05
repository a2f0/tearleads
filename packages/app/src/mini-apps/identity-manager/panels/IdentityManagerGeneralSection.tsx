import type { ReactNode } from "react";
import { CopyMyIdentityLinkButton } from "../../../components/identity/CopyMyIdentityLinkButton";
import {
  MiniAppClipboardButton,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatePanel,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import { useAccountBootstrapProgress } from "../../../identity/useAccountBootstrapProgress";
import { useDeveloperMode } from "../../../providers/developer-mode/DeveloperModeProvider";
import type { useIdentityManager } from "../IdentityManagerController";
import { compactIdentifier } from "../sessions/IdentityManagerSessionDisplay";
import {
  IdentityActionToolbar,
  type IdentityActionToolbarProps,
  IdentityDestroyKeyPair,
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

/** Raw identifiers, shown only in developer mode. */
function IdentityDeveloperDetails({ model }: { model: IdentityManagerModel }) {
  const { identity, session } = model;
  return (
    <>
      <IdentityDetail
        action={
          <MiniAppClipboardButton
            label="Copy signing key fingerprint"
            value={identity.signingFingerprint}
          />
        }
        label="Signing Key"
        value={identity.signingFingerprint}
      />
      <IdentityDetail
        action={
          <MiniAppClipboardButton label="Copy user ID" value={session.userId} />
        }
        label="User ID"
        value={session.userId}
      />
      <IdentityDetail label="Organization ID" value={session.organizationId} />
      <IdentityDetail label="Container ID" value={session.containerId} />
    </>
  );
}

function getIdentitySectionActions({
  canAuthenticate,
  identity,
  identityMutations,
  localKeyringLocked,
  registration,
}: IdentityManagerModel): IdentityActionToolbarProps {
  return {
    canAuthenticate,
    canGenerateKey: !localKeyringLocked,
    canRegisterCurrentIdentity: registration.canRegisterCurrentIdentity,
    generateKey: identity.generateKey,
    handleAuthenticate: identityMutations.authenticate,
    handleDestroyKeyPair: identityMutations.requestDestroyKeyPackage,
    handleRegisterIdentity: identityMutations.handleRegisterIdentity,
    hasSigningKeyPair: identity.signingKeyPair !== null,
    identityBusy: identity.identityTransitionInFlight
      ? "transition"
      : identityMutations.identityBusy,
  };
}

export function IdentityManagerGeneralSection({
  model,
}: {
  model: IdentityManagerModel;
}) {
  const { identityMutations, identityState, session } = model;
  const actions = getIdentitySectionActions(model);
  const { isDeveloperMode } = useDeveloperMode();
  const progress = useAccountBootstrapProgress();

  // While the account is still being restored, created, or signed in, every
  // control here is either disabled or about to change; one centered panel
  // says so instead of spinner lines threaded between them.
  if (progress) {
    return (
      <MiniAppStatePanel
        busy
        description={progress.description}
        title={progress.title}
      />
    );
  }

  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>Identity</h2>
        <MiniAppStatus as="span">{identityState}</MiniAppStatus>
      </MiniAppSectionHeading>
      {identityMutations.identityError && (
        <MiniAppStatus tone="error">
          {identityMutations.identityError}
        </MiniAppStatus>
      )}
      <CopyMyIdentityLinkButton />
      <dl className="identity-manager-details">
        {isDeveloperMode && <IdentityDeveloperDetails model={model} />}
        <dt>Authentication</dt>
        <dd>{session.isAuthenticated ? "Authenticated" : "Signed out"}</dd>
      </dl>
      <IdentityActionToolbar {...actions} />
      {actions.hasSigningKeyPair && (
        <IdentityDestroyKeyPair
          disabled={actions.identityBusy !== null}
          onDestroy={actions.handleDestroyKeyPair}
        />
      )}
    </MiniAppSection>
  );
}
