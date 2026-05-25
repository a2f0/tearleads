import { isUserEvent } from "@tearleads/validators/event";
import { useNetworkState } from "../../providers/api/useNetworkState";
import { useCryptoSession } from "../../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../../providers/db/DatabaseProvider";
import { useEvents } from "../../providers/events/useEvents";
import { useIdentity } from "../../providers/identity/IdentityProvider";
import { usePeerUserId } from "./DualPaneProvider";

export function PaneStatus() {
  const { id, status } = useDatabase();
  const { userId, authToken } = useCryptoSession();
  const { signingFingerprint } = useIdentity();
  const { events, connected } = useEvents();
  const { online } = useNetworkState();
  const peerUserId = usePeerUserId();

  return (
    <div className="pane-content">
      sqlite worker: {status}
      <br />
      id: {id}
      <br />
      publicKey: {signingFingerprint ?? "none"}
      <br />
      userId: {userId ?? "none"}
      <br />
      peerUserId: {peerUserId ?? "none"}
      <br />
      session: {authToken ? authToken.slice(0, 32) : "none"}
      <br />
      network: {online ? "online" : "offline"}
      <br />
      ws: {connected ? "connected" : "disconnected"}
      <br />
      events: {events.length === 0 ? "none" : ""}
      {events.map((e) => (
        <div key={e.id}>
          {e.type}
          {isUserEvent(e) ? ` (${e.userId})` : ""}
        </div>
      ))}
    </div>
  );
}
