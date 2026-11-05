import { useAccountBootstrapProgress } from "../../identity/useAccountBootstrapProgress";
import { useAuthenticateAction } from "../../identity/useAuthenticateAction";
import { MiniAppButton, MiniAppStatus } from "../mini-app/MiniAppLayout";

export function IdentityLinkSignIn() {
  const progress = useAccountBootstrapProgress();
  const { authenticate, authenticating, error } = useAuthenticateAction();
  // The progress takes the Sign in button's place, spinner inside the button,
  // so the surrounding form does not shift or gain a stray status line.
  if (progress) {
    return (
      <MiniAppButton loading title={progress.description} type="button">
        {progress.title}...
      </MiniAppButton>
    );
  }
  return (
    <>
      {error && (
        <MiniAppStatus role="alert" tone="error">
          {error}
        </MiniAppStatus>
      )}
      <MiniAppButton
        disabled={authenticating}
        onClick={() => void authenticate()}
        type="button"
      >
        {authenticating ? "Signing in..." : "Sign in"}
      </MiniAppButton>
    </>
  );
}
