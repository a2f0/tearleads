import { useCallback, useState } from "react";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { useLog } from "../providers/logging/LogProvider";
import { useSymCrypt } from "../providers/sdk/SymCryptProvider";

/**
 * Human-facing reason for a failed authentication attempt. A lost connection is
 * the one cause worth calling out on its own: on a browser shell the API client
 * flips the network store offline the moment a request fails to reach the server
 * (its `kind: "network"` path), so an offline store after a failed login means
 * the request never landed rather than that the server rejected the identity.
 * Everything else is reported as a plain authentication failure. Native shells
 * bind an authoritative OS connectivity source, so a login that fails to reach a
 * reachable-device's backend keeps the store online and reports the generic
 * reason — the device genuinely has a network, so "no network connection" would
 * be misleading; the unreachable backend is a server problem, not the device's.
 */
export function describeAuthenticationFailure(input: {
  readonly online: boolean;
}): string {
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
  const symcrypt = useSymCrypt();
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authenticate = useCallback(async (): Promise<boolean> => {
    setAuthenticating(true);
    setError(null);
    try {
      const authenticated = await login();
      if (!authenticated) {
        // Read the network store now, not a render-time snapshot. The API
        // client's network-error handler runs within the failed request's async
        // chain (before login() resolves), so the store already reflects this
        // attempt; a future async hop in that handler would regress this to the
        // generic reason.
        setError(
          describeAuthenticationFailure({ online: symcrypt.network.online }),
        );
      }
      return authenticated;
    } catch (caught: unknown) {
      logError("Authentication failed", caught);
      setError(
        describeAuthenticationFailure({ online: symcrypt.network.online }),
      );
      return false;
    } finally {
      setAuthenticating(false);
    }
  }, [login, logError, symcrypt]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return { authenticate, authenticating, error, clearError };
}
