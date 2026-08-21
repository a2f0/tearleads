import { isUserEvent } from "@symcrypt/validators/event";
import { useMemo } from "react";
import { useNetworkState } from "../../../providers/api/useNetworkState";
import { useCryptoSession } from "../../../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../../../providers/db/DatabaseProvider";
import { useEvents } from "../../../providers/events/useEvents";
import { useIdentity } from "../../../providers/identity/IdentityProvider";
import { useDualPane, usePeerUserId } from "../dual-pane";

// Human-readable labels for the raw status keys, so the UI shows
// "Web Socket" instead of "ws", "Public Key" instead of "publicKey", etc.
// Shared with the System Monitor's support report so a pasted report names its
// fields exactly as the Status tab does.
export const STATUS_LABELS = {
  sqliteWorker: "SQLite Worker",
  id: "ID",
  publicKey: "Public Key",
  userId: "User ID",
  peerUserId: "Peer User ID",
  session: "Session",
  network: "Network",
  ws: "Web Socket",
  events: "Events",
} as const;

export const NO_STATUS_VALUE = "none";

export interface SystemStatusEvent {
  readonly id: string;
  readonly label: string;
}

/**
 * The Status tab's contents as plain data.
 *
 * This exists so the System Monitor's support report can serialize status
 * without the Status tab being mounted — the copy button lives in the tab bar
 * and must capture every tab regardless of which one is open. Rendering and
 * serialization therefore read one source rather than each calling the six
 * underlying providers themselves.
 */
export interface SystemStatusSnapshot {
  readonly events: ReadonlyArray<SystemStatusEvent>;
  readonly id: string;
  readonly network: string;
  /** `null` when peer user IDs are disabled, which drops the row entirely. */
  readonly peerUserId: string | null;
  readonly publicKey: string;
  readonly session: string;
  readonly sqliteWorker: string;
  readonly userId: string;
  readonly ws: string;
}

export function useSystemStatusSnapshot(): SystemStatusSnapshot {
  const { id, status } = useDatabase();
  const { userId, authToken } = useCryptoSession();
  const { signingFingerprint } = useIdentity();
  const { events, connected } = useEvents();
  const { mode, online } = useNetworkState();
  const peerUserId = usePeerUserId();
  // Peer user ids are a demo-only feature (the `panePeerUserIds` host profile
  // flag); the normal app reads `false` and suppresses peer-only rows entirely
  // rather than rendering them in a permanently empty state.
  const { peerUserIdsEnabled } = useDualPane();

  return useMemo(() => {
    const networkLabel = `${online ? "online" : "offline"}${
      mode === "automatic" ? "" : " (manual)"
    }`;

    return {
      events: events.map((event) => ({
        id: event.id,
        label: `${event.type}${isUserEvent(event) ? ` (${event.userId})` : ""}`,
      })),
      // Reported as "none" rather than blank: an empty cell in a support paste
      // is indistinguishable from a field that failed to serialize.
      id: id ?? NO_STATUS_VALUE,
      network: networkLabel,
      peerUserId: peerUserIdsEnabled ? (peerUserId ?? NO_STATUS_VALUE) : null,
      publicKey: signingFingerprint ?? NO_STATUS_VALUE,
      // Truncated deliberately: the full bearer token must never reach a support
      // paste, but a prefix is enough to correlate against server-side logs.
      session: authToken ? `${authToken.slice(0, 6)}...` : NO_STATUS_VALUE,
      sqliteWorker: status,
      userId: userId ?? NO_STATUS_VALUE,
      ws: connected ? "connected" : "disconnected",
    };
  }, [
    authToken,
    connected,
    events,
    id,
    mode,
    online,
    peerUserId,
    peerUserIdsEnabled,
    signingFingerprint,
    status,
    userId,
  ]);
}
