import { useEffect, useState } from "react";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { useIdentityLinks } from "../providers/identity-links/useIdentityLinks";
import { useLog } from "../providers/logging/LogProvider";
import { usePeerIdentityLink, usePeerUserId } from "../shell/pane/dual-pane";

// The peer pane publishes its link as soon as its keys exist, which can be
// before the server answers for that identity, so verification retries.
const VERIFY_MAX_ATTEMPTS = 10;
const VERIFY_RETRY_MS = 2000;

/**
 * The peer pane's user ID once this pane has verified the peer's identity
 * link, and `null` until then. The demo admits its peer (contact, roster
 * member) only through this, exactly as a person would by exchanging links.
 */
export function useVerifiedPeerUserId(enabled: boolean): string | null {
  const peerUserId = usePeerUserId();
  const peerLink = usePeerIdentityLink();
  const { isAuthenticated } = useCryptoSession();
  const { verifyLink } = useIdentityLinks();
  const { logError } = useLog();
  const [verified, setVerified] = useState<{
    readonly link: string;
    readonly userId: string;
  } | null>(null);

  useEffect(() => {
    if (!enabled || !isAuthenticated || !peerLink || !peerUserId) {
      return;
    }
    let active = true;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (): void => {
      verifyLink(peerLink).then(
        (identity) => {
          if (active && identity.userId === peerUserId) {
            setVerified({ link: peerLink, userId: identity.userId });
          }
        },
        (error: unknown) => {
          if (!active) return;
          attempts += 1;
          if (attempts < VERIFY_MAX_ATTEMPTS) {
            retryTimer = setTimeout(attempt, VERIFY_RETRY_MS);
          } else {
            logError("Demo peer bootstrap: could not verify the peer.", error);
          }
        },
      );
    };
    attempt();
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [enabled, isAuthenticated, logError, peerLink, peerUserId, verifyLink]);

  return verified?.link === peerLink && verified.userId === peerUserId
    ? verified.userId
    : null;
}
