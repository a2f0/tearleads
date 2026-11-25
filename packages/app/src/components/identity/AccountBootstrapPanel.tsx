import { SignInIcon } from "@phosphor-icons/react/dist/csr/SignIn";
import { useAutoProvisioningStatus } from "../../identity/autoProvisioningStatus";
import { useAccountBootstrapProgress } from "../../identity/useAccountBootstrapProgress";
import {
  type AuthenticateAction,
  useAuthenticateAction,
} from "../../identity/useAuthenticateAction";
import { useDatabase } from "../../providers/db/DatabaseProvider";
import { useIdentity } from "../../providers/identity/IdentityProvider";
import {
  MiniAppButton,
  MiniAppStatePanel,
  MiniAppStatus,
} from "../mini-app/MiniAppLayout";
import { AccountBootstrapProgressPanel } from "./AccountBootstrapProgressPanel";
import { TwoFactorSignInForm } from "./TwoFactorSignInForm";

const SIGN_IN_ICON = <SignInIcon size={40} weight="light" />;

const DATABASE_FAILED_MESSAGE =
  "This device's local database could not start. Reload to try again.";

/** A fresh boot restarts the database with a new retry budget. */
function DatabaseFailedRecovery() {
  return (
    <>
      <MiniAppButton onClick={() => window.location.reload()}>
        Reload
      </MiniAppButton>
      <MiniAppStatus role="alert" tone="error">
        {DATABASE_FAILED_MESSAGE}
      </MiniAppStatus>
    </>
  );
}

function AccountSignInPanel({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  const { signingKeyPair } = useIdentity();
  const { status: databaseStatus } = useDatabase();
  const { generation, registration } = useAutoProvisioningStatus();
  const { authenticate, authenticating, error, twoFactorPrompt } =
    useAuthenticateAction();
  const failedStep = signingKeyPair === null ? generation : registration;
  const reason =
    error ?? (failedStep.status === "failed" ? failedStep.message : null);

  return (
    <MiniAppStatePanel
      description={description}
      icon={SIGN_IN_ICON}
      title={title}
    >
      {databaseStatus === "error" ? (
        <DatabaseFailedRecovery />
      ) : (
        <AccountSignInAction
          authenticate={authenticate}
          authenticating={authenticating}
          canAuthenticate={signingKeyPair !== null}
          reason={reason}
          twoFactorPrompt={twoFactorPrompt !== null}
        />
      )}
    </MiniAppStatePanel>
  );
}

function AccountSignInAction({
  authenticate,
  authenticating,
  canAuthenticate,
  reason,
  twoFactorPrompt,
}: {
  authenticate: AuthenticateAction["authenticate"];
  authenticating: boolean;
  canAuthenticate: boolean;
  reason: string | null;
  twoFactorPrompt: boolean;
}) {
  return (
    <>
      {canAuthenticate && twoFactorPrompt && (
        <TwoFactorSignInForm
          authenticate={authenticate}
          authenticating={authenticating}
        />
      )}
      {canAuthenticate && !twoFactorPrompt && (
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
    </>
  );
}

/**
 * The whole-surface stand-in for a mini-app that needs a signed-in account.
 * While the account is still being restored, named, created, or signed in it
 * shows that progress; only once nothing is in flight does it ask the user to
 * log in.
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
    return <AccountBootstrapProgressPanel progress={copy} />;
  }

  return (
    <AccountSignInPanel
      description={signedOutDescription}
      title={signedOutTitle}
    />
  );
}
