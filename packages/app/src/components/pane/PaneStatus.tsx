import { isUserEvent } from "@tearleads/validators/event";
import { useNetworkState } from "../../api/NetworkStateProvider";
import { useCryptoSession } from "../../crypto/CryptoSessionProvider";
import { useDatabase } from "../../db/DatabaseProvider";
import { useEvents } from "../../events/EventsProvider";
import { usePersona } from "../../persona/PersonaProvider";
import { usePeerUserId } from "./DualPaneProvider";

export function PaneStatus() {
  const { id, status } = useDatabase();
  const { userId, authToken } = useCryptoSession();
  const { signingFingerprint } = usePersona();
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
