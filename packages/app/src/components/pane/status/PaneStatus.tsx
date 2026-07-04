import { isUserEvent } from "@tearleads/validators/event";
import {
  MiniAppInfoRow,
  MiniAppInfoTable,
} from "../../../components/shared/MiniAppTable";
import { useNetworkModeContextMenu } from "../../../components/shared/NetworkModeContextMenu";
import { useNetworkState } from "../../../providers/api/useNetworkState";
import { useCryptoSession } from "../../../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../../../providers/db/DatabaseProvider";
import { useEvents } from "../../../providers/events/useEvents";
import { useIdentity } from "../../../providers/identity/IdentityProvider";
import { usePeerUserId, usePeerUserIdsEnabled } from "../DualPaneProvider";

// Human-readable labels for the raw status keys, so the UI shows
// "Web Socket" instead of "ws", "Public Key" instead of "publicKey", etc.
const STATUS_LABELS = {
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

export function PaneStatus() {
  const { id, status } = useDatabase();
  const { userId, authToken } = useCryptoSession();
  const { signingFingerprint } = useIdentity();
  const { events, connected } = useEvents();
  const { mode, online } = useNetworkState();
  const networkContextMenu = useNetworkModeContextMenu();
  const peerUserId = usePeerUserId();
  const peerUserIdsEnabled = usePeerUserIdsEnabled();
  const networkLabel = `${online ? "online" : "offline"}${
    mode === "automatic" ? "" : " (manual)"
  }`;

  return (
    <section
      aria-label="System status"
      className="pane-content"
      onContextMenu={networkContextMenu.handleContextMenu}
    >
      <MiniAppInfoTable>
        <tbody>
          <MiniAppInfoRow label={STATUS_LABELS.sqliteWorker}>
            {status}
          </MiniAppInfoRow>
          <MiniAppInfoRow label={STATUS_LABELS.id}>{id}</MiniAppInfoRow>
          <MiniAppInfoRow label={STATUS_LABELS.publicKey}>
            {signingFingerprint ?? "none"}
          </MiniAppInfoRow>
          <MiniAppInfoRow label={STATUS_LABELS.userId}>
            {userId ?? "none"}
          </MiniAppInfoRow>
          {peerUserIdsEnabled ? (
            <MiniAppInfoRow label={STATUS_LABELS.peerUserId}>
              {peerUserId ?? "none"}
            </MiniAppInfoRow>
          ) : null}
          <MiniAppInfoRow label={STATUS_LABELS.session}>
            {authToken ? `${authToken.slice(0, 6)}...` : "none"}
          </MiniAppInfoRow>
          <MiniAppInfoRow label={STATUS_LABELS.network}>
            {networkLabel}
          </MiniAppInfoRow>
          <MiniAppInfoRow label={STATUS_LABELS.ws}>
            {connected ? "connected" : "disconnected"}
          </MiniAppInfoRow>
          <MiniAppInfoRow label={STATUS_LABELS.events}>
            {events.length === 0
              ? "none"
              : events.map((e) => (
                  <div key={e.id}>
                    {e.type}
                    {isUserEvent(e) ? ` (${e.userId})` : ""}
                  </div>
                ))}
          </MiniAppInfoRow>
        </tbody>
      </MiniAppInfoTable>
      {networkContextMenu.contextMenu}
    </section>
  );
}
