import { SignInIcon } from "@phosphor-icons/react/dist/csr/SignIn";
import { useAutoProvisioningStatus } from "../../identity/autoProvisioningStatus";
import { useAccountBootstrapProgress } from "../../identity/useAccountBootstrapPhase";
import { useAuthenticateAction } from "../../identity/useAuthenticateAction";
import { useIdentity } from "../../providers/identity/IdentityProvider";
import {
  MiniAppButton,
  MiniAppStatePanel,
  MiniAppStatus,
} from "../mini-app/MiniAppLayout";

const SIGN_IN_ICON = <SignInIcon size={40} weight="light" />;

function AccountSignInPanel({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  const { signingKeyPair } = useIdentity();
  const { registration } = useAutoProvisioningStatus();
  const { authenticate, authenticating, error } = useAuthenticateAction();
  const reason =
    error ?? (registration.status === "failed" ? registration.message : null);

  return (
    <MiniAppStatePanel
      description={description}
      icon={SIGN_IN_ICON}
      title={title}
    >
      {signingKeyPair !== null && (
        <MiniAppButton
          loading={authenticating}
          onClick={() => void authenticate()}
        >
          {authenticating ? "Logging in..." : "Login"}
        </MiniAppButton>
      )}
      {reason && (
        <MiniAppStatus role="alert" tone="error">
          {reason}
        </MiniAppStatus>
      )}
    </MiniAppStatePanel>
  );
}

/**
 * The whole-surface stand-in for a mini-app that needs a signed-in account.
 * While the account is still being restored, created, or signed in it shows
 * that progress; only once nothing is in flight does it ask the user to log in.
 */
export function AccountBootstrapPanel({
  signedOutDescription,
  signedOutTitle,
}: {
  signedOutDescription: string;
  signedOutTitle: string;
}) {
  const copy = useAccountBootstrapProgress();

  if (copy) {
    return (
      <MiniAppStatePanel
        busy
        description={copy.description}
        title={copy.title}
      />
    );
  }

  return (
    <AccountSignInPanel
      description={signedOutDescription}
      title={signedOutTitle}
    />
  );
}
