import { toFingerprint } from "@tearleads/crypto";
import { isUserEvent } from "@tearleads/validators/event";
import { useEffect, useState } from "react";
import { useNetworkState } from "../../api/NetworkStateProvider";
import { useContacts } from "../../contacts/ContactsProvider";
import { useCryptoSession } from "../../crypto/CryptoSessionProvider";
import { useDatabase } from "../../db/DatabaseProvider";
import { useEvents } from "../../events/EventsProvider";
import { usePeerUserId } from "./DualPaneProvider";

export function PaneStatus() {
  const { id, status } = useDatabase();
  const { signingKeyPair, userId, authToken } = useCryptoSession();
  const { entries } = useContacts();
  const { events, connected } = useEvents();
  const { online } = useNetworkState();
  const peerUserId = usePeerUserId();
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  useEffect(() => {
    if (signingKeyPair) {
      toFingerprint(signingKeyPair.signingPublicKey).then(setFingerprint);
    } else {
      setFingerprint(null);
    }
  }, [signingKeyPair]);

  return (
    <div className="pane-content">
      sqlite worker: {status}
      <br />
      id: {id}
      <br />
      publicKey: {fingerprint ?? "none"}
      <br />
      userId: {userId ?? "none"}
      <br />
      peerUserId: {peerUserId ?? "none"}
      <br />
      session: {authToken ? authToken.slice(0, 32) : "none"}
      <br />
      contacts: {entries.length}
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
