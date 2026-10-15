import { useAuthenticateAction } from "../../identity/useAuthenticateAction";
import { MiniAppButton, MiniAppStatus } from "../mini-app/MiniAppLayout";

export function IdentityLinkSignIn() {
  const { authenticate, authenticating, error } = useAuthenticateAction();
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
