import { isUserEvent } from "@tearleads/validators/event";
import {
  MiniAppInfoRow,
  MiniAppInfoTable,
} from "../../../components/shared/MiniAppTable";
import { useNetworkState } from "../../../providers/api/useNetworkState";
import { useCryptoSession } from "../../../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../../../providers/db/DatabaseProvider";
import { useEvents } from "../../../providers/events/useEvents";
import { useIdentity } from "../../../providers/identity/IdentityProvider";
import { usePeerUserId } from "../DualPaneProvider";

export function PaneStatus() {
  const { id, status } = useDatabase();
  const { userId, authToken } = useCryptoSession();
  const { signingFingerprint } = useIdentity();
  const { events, connected } = useEvents();
  const { mode, online } = useNetworkState();
  const peerUserId = usePeerUserId();
  const networkLabel = `${online ? "online" : "offline"}${
    mode === "automatic" ? "" : " (manual)"
  }`;

  return (
    <div className="pane-content">
      <MiniAppInfoTable>
        <tbody>
          <MiniAppInfoRow label="sqlite worker">{status}</MiniAppInfoRow>
          <MiniAppInfoRow label="id">{id}</MiniAppInfoRow>
          <MiniAppInfoRow label="publicKey">
            {signingFingerprint ?? "none"}
          </MiniAppInfoRow>
          <MiniAppInfoRow label="userId">{userId ?? "none"}</MiniAppInfoRow>
          <MiniAppInfoRow label="peerUserId">
            {peerUserId ?? "none"}
          </MiniAppInfoRow>
          <MiniAppInfoRow label="session">
            {authToken ? `${authToken.slice(0, 6)}...` : "none"}
          </MiniAppInfoRow>
          <MiniAppInfoRow label="network">{networkLabel}</MiniAppInfoRow>
          <MiniAppInfoRow label="ws">
            {connected ? "connected" : "disconnected"}
          </MiniAppInfoRow>
          <MiniAppInfoRow label="events">
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
    </div>
  );
}
