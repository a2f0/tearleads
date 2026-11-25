import type {
  SessionTwoFactorCode,
  TwoFactorLoginErrorCode,
} from "@tearleads/client-sdk";
import { useCallback, useState } from "react";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { useLog } from "../providers/logging/LogProvider";
import { useTearleads } from "../providers/sdk/TearleadsProvider";
import {
  IDENTITY_ACKNOWLEDGMENT_MISMATCH_MESSAGE,
  isIdentityAcknowledgmentMismatch,
} from "./identityAcknowledgmentMismatch";

const TWO_FACTOR_MESSAGES: Readonly<Record<TwoFactorLoginErrorCode, string>> = {
  two_factor_invalid: "That code did not match. Try again.",
  two_factor_locked:
    "Too many incorrect codes. Wait 15 minutes, then try again.",
  two_factor_required: "Enter the code from your authenticator app.",
};

function isTwoFactorPromptCode(code: unknown): code is TwoFactorLoginErrorCode {
  return typeof code === "string" && Object.hasOwn(TWO_FACTOR_MESSAGES, code);
}

/** The second factor a refused sign-in asks for, matched like suspension. */
function twoFactorRefusal(error: unknown): TwoFactorLoginErrorCode | null {
  if (!(error instanceof Error) || error.name !== "TwoFactorLoginError") {
    return null;
  }
  const code = Reflect.get(error, "code");
  return isTwoFactorPromptCode(code) ? code : null;
}

export const ACCOUNT_SUSPENDED_MESSAGE =
  "This account is suspended. Contact support to restore access.";

/** The SDK's terminal refusal for an account a platform operator suspended. */
function isAccountSuspended(error: unknown): boolean {
  return error instanceof Error && error.name === "AccountSuspendedError";
}

/**
 * Human-facing reason for a failed authentication attempt. Three causes are
 * worth calling out on their own. A suspended account cannot sign in until the
 * suspension is lifted, so retrying will not help. A server that answered this
 * identity with a different account is an integrity refusal, never a
 * connectivity problem. A lost connection: browser and native shells bind a
 * live connectivity source, so an offline store means that source observed a
 * device connectivity loss. A backend request failure alone keeps the store
 * online and reports the generic reason — an unreachable backend is a server
 * problem, not proof that the device has no network.
 */
export function describeAuthenticationFailure(input: {
  readonly accountSuspended?: boolean | undefined;
  readonly identityMismatch?: boolean | undefined;
  readonly online: boolean;
}): string {
  if (input.accountSuspended) {
    return ACCOUNT_SUSPENDED_MESSAGE;
  }
  if (input.identityMismatch) {
    return IDENTITY_ACKNOWLEDGMENT_MISMATCH_MESSAGE;
  }
  return input.online
    ? "Authentication failed."
    : "Authentication failed: no network connection.";
}

export interface AuthenticateAction {
  /**
   * Run the login, with a second factor once one was asked for; resolves to
   * whether authentication succeeded.
   */
  readonly authenticate: (twoFactor?: SessionTwoFactorCode) => Promise<boolean>;
  readonly authenticating: boolean;
  /** A human reason for the most recent failure, or null when there is none. */
  readonly error: string | null;
  readonly clearError: () => void;
  /**
   * Set while sign-in waits on a code from the person: the identity has
   * two-factor on and this device sent none, or the last code failed.
   */
  readonly twoFactorPrompt: TwoFactorLoginErrorCode | null;
}

/**
 * Shared "log in with the current identity" action: runs the crypto-session
 * login, tracks a busy flag, and derives a human error on failure — surfacing a
 * lost connection instead of the generic message. Used by both the Identity
 * Manager and the Org Manager authentication gate so the two report the same
 * reason from one place.
 */
export function useAuthenticateAction(): AuthenticateAction {
  const { login, loginWithSecondFactor } = useCryptoSession();
  const { logError } = useLog();
  const tearleads = useTearleads();
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [twoFactorPrompt, setTwoFactorPrompt] =
    useState<TwoFactorLoginErrorCode | null>(null);

  const authenticate = useCallback(
    async (twoFactor?: SessionTwoFactorCode): Promise<boolean> => {
      setAuthenticating(true);
      setError(null);
      try {
        const authenticated = twoFactor
          ? await loginWithSecondFactor(twoFactor)
          : await login();
        if (authenticated) setTwoFactorPrompt(null);
        if (!authenticated) {
          // Read the network store now, not a render-time snapshot, so a source
          // event that arrived during the authentication attempt is reflected.
          setError(
            describeAuthenticationFailure({ online: tearleads.network.online }),
          );
        }
        return authenticated;
      } catch (caught: unknown) {
        const refusal = twoFactorRefusal(caught);
        if (refusal) {
          setTwoFactorPrompt(refusal);
          setError(TWO_FACTOR_MESSAGES[refusal]);
          return false;
        }
        const identityMismatch = isIdentityAcknowledgmentMismatch(caught);
        logError(
          identityMismatch
            ? "Authentication refused by identity acknowledgment"
            : "Authentication failed",
          caught,
        );
        setError(
          describeAuthenticationFailure({
            accountSuspended: isAccountSuspended(caught),
            identityMismatch,
            online: tearleads.network.online,
          }),
        );
        return false;
      } finally {
        setAuthenticating(false);
      }
    },
    [login, loginWithSecondFactor, logError, tearleads],
  );

  const clearError = useCallback(() => {
    setError(null);
    setTwoFactorPrompt(null);
  }, []);

  return { authenticate, authenticating, error, clearError, twoFactorPrompt };
}
