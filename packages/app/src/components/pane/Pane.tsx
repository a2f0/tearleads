import { toFingerprint } from "@tearleads/crypto";
import { useCallback, useEffect, useState } from "react";
import { useAddressBook } from "../../crypto/AddressBookProvider";
import { useCryptoSession } from "../../crypto/CryptoSessionProvider";
import { useDatabase } from "../../db/DatabaseProvider";
import { useEvents } from "../../events/EventsProvider";
import { useLog } from "../../logging/LogProvider";
import type { MenuPosition } from "../shared/Menu";
import { PaneMenu } from "../shared/PaneMenu";
import { usePeerUserId, useRegisterUserId } from "./DualPaneProvider";
import "./Pane.css";

export function Pane({ className }: { className: string }) {
  const { id, status } = useDatabase();
  const { signingKeyPair, userId, authToken } = useCryptoSession();
  const { entries } = useAddressBook();
  const { events, connected } = useEvents();
  const { entries: logEntries } = useLog();
  useRegisterUserId(userId);
  const peerUserId = usePeerUserId();
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  useEffect(() => {
    if (signingKeyPair) {
      toFingerprint(signingKeyPair.signingPublicKey).then(setFingerprint);
    } else {
      setFingerprint(null);
    }
  }, [signingKeyPair]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  return (
    <section className={className}>
      <div className="pane-content">
        worker: {status}
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
        addressBook: {entries.length === 0 ? "empty" : ""}
        {entries.map((e) => (
          <div key={e.userId}>
            {e.userId}: {e.encapsulationPublicKey.slice(0, 16)}...
          </div>
        ))}
        <br />
        ws: {connected ? "connected" : "disconnected"}
        <br />
        events: {events.length === 0 ? "none" : ""}
        {events.map((e, i) => (
          <div key={i}>{e.type}</div>
        ))}
      </div>
      <div className="pane-log">
        {logEntries.map((entry, i) => (
          <div key={i}>
            [{new Date(entry.timestamp).toLocaleTimeString()}] {entry.message}
          </div>
        ))}
      </div>
      <div className="pane-footer">
        <button type="button" onClick={handleClick}>
          Menu
        </button>
      </div>
      {menu && <PaneMenu position={menu} onClose={closeMenu} />}
    </section>
  );
}
