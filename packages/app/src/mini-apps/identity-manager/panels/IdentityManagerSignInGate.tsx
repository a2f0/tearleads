import { AccountBootstrapProgressPanel } from "../../../components/identity/AccountBootstrapProgressPanel";
import { TwoFactorSignInForm } from "../../../components/identity/TwoFactorSignInForm";
import {
  MiniAppButton,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import { useAccountBootstrapProgress } from "../../../identity/useAccountBootstrapProgress";
import type { useIdentityManager } from "../IdentityManagerController";

/**
 * Stands in for a section that needs a signed-in account: account setup
 * progress while it runs, then a login, which asks for a code when the
 * identity has two-factor on.
 */
export function IdentityManagerSignInGate({
  message,
  model,
  title,
}: {
  readonly message: string;
  readonly model: ReturnType<typeof useIdentityManager>;
  readonly title: string;
}) {
  const { canAuthenticate, identity, identityMutations } = model;
  const progress = useAccountBootstrapProgress();
  if (progress) {
    return <AccountBootstrapProgressPanel progress={progress} />;
  }

  const identityBusy =
    identity.identityTransitionInFlight ||
    identityMutations.identityBusy !== null;

  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>{title}</h2>
      </MiniAppSectionHeading>
      <MiniAppStatus>{message}</MiniAppStatus>
      {identityMutations.identityError && (
        <MiniAppStatus tone="error">
          {identityMutations.identityError}
        </MiniAppStatus>
      )}
      {canAuthenticate && identityMutations.twoFactorPrompt && (
        <TwoFactorSignInForm
          authenticate={identityMutations.authenticate}
          authenticating={identityMutations.identityBusy === "authenticate"}
        />
      )}
      {canAuthenticate && !identityMutations.twoFactorPrompt && (
        <MiniAppToolbar>
          <MiniAppButton
            disabled={identityBusy}
            onClick={() => void identityMutations.authenticate()}
          >
            {identityMutations.identityBusy === "authenticate"
              ? "Logging in..."
              : "Login"}
          </MiniAppButton>
        </MiniAppToolbar>
      )}
    </MiniAppSection>
  );
}
