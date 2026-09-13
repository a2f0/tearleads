import { useCallback, useState } from "react";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { useLog } from "../providers/logging/LogProvider";
import { useTearleads } from "../providers/sdk/TearleadsProvider";
import {
  IDENTITY_ACKNOWLEDGMENT_MISMATCH_MESSAGE,
  isIdentityAcknowledgmentMismatch,
} from "./identityAcknowledgmentMismatch";

/**
 * Human-facing reason for a failed authentication attempt. Two causes are worth
 * calling out on their own. A server that answered this identity with a
 * different account is an integrity refusal, never a connectivity problem. A
 * lost connection: browser and native shells bind a live connectivity source,
 * so an offline store means that source observed a device connectivity loss. A
 * backend request failure alone keeps the store online and reports the generic
 * reason — an unreachable backend is a server problem, not proof that the
 * device has no network.
 */
export function describeAuthenticationFailure(input: {
  readonly identityMismatch?: boolean | undefined;
  readonly online: boolean;
}): string {
  if (input.identityMismatch) {
    return IDENTITY_ACKNOWLEDGMENT_MISMATCH_MESSAGE;
  }
  return input.online
    ? "Authentication failed."
    : "Authentication failed: no network connection.";
}

interface AuthenticateAction {
  /** Run the login; resolves to whether authentication succeeded. */
  readonly authenticate: () => Promise<boolean>;
  readonly authenticating: boolean;
  /** A human reason for the most recent failure, or null when there is none. */
  readonly error: string | null;
  readonly clearError: () => void;
}

/**
 * Shared "log in with the current identity" action: runs the crypto-session
 * login, tracks a busy flag, and derives a human error on failure — surfacing a
 * lost connection instead of the generic message. Used by both the Identity
 * Manager and the Org Manager authentication gate so the two report the same
 * reason from one place.
 */
export function useAuthenticateAction(): AuthenticateAction {
  const { login } = useCryptoSession();
  const { logError } = useLog();
  const tearleads = useTearleads();
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authenticate = useCallback(async (): Promise<boolean> => {
    setAuthenticating(true);
    setError(null);
    try {
      const authenticated = await login();
      if (!authenticated) {
        // Read the network store now, not a render-time snapshot, so a source
        // event that arrived during the authentication attempt is reflected.
        setError(
          describeAuthenticationFailure({ online: tearleads.network.online }),
        );
      }
      return authenticated;
    } catch (caught: unknown) {
      const identityMismatch = isIdentityAcknowledgmentMismatch(caught);
      logError(
        identityMismatch
          ? "Authentication refused by identity acknowledgment"
          : "Authentication failed",
        caught,
      );
      setError(
        describeAuthenticationFailure({
          identityMismatch,
          online: tearleads.network.online,
        }),
      );
      return false;
    } finally {
      setAuthenticating(false);
    }
  }, [login, logError, tearleads]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return { authenticate, authenticating, error, clearError };
}
