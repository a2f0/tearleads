import type { ReactNode } from "react";
import {
  MiniAppClipboardButton,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import { useDeveloperMode } from "../../../providers/developer-mode/DeveloperModeProvider";
import { useUserIdentityLink } from "../../../providers/identity-links/useUserIdentityLink";
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

function identityLinkStatus(input: {
  error: string | null;
  pending: boolean;
  signedIn: boolean;
}): string {
  if (!input.signedIn) return "Sign in to share your identity link.";
  if (input.pending) return "Preparing identity link...";
  return input.error ?? "Your identity link is unavailable.";
}

/** The signed-in user's own identity link, the one others verify you by. */
function IdentityLinkDetail({ userId }: { userId: string | null }) {
  const { error, link, pending } = useUserIdentityLink(userId);
  return (
    <>
      <dt>Identity link</dt>
      <dd>
        {link ? (
          <>
            <span className="identity-manager-detail-text" title={link}>
              {link}
            </span>
            <MiniAppClipboardButton label="Copy identity link" value={link} />
          </>
        ) : (
          <MiniAppStatus as="span">
            {identityLinkStatus({ error, pending, signedIn: userId !== null })}
          </MiniAppStatus>
        )}
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
      <dl className="identity-manager-details">
        <IdentityLinkDetail
          userId={session.isAuthenticated ? session.userId : null}
        />
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
