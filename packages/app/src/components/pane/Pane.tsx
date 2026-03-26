import { toFingerprint } from "@tearleads/crypto";
import { isUserEvent } from "@tearleads/validators/event";
import { useCallback, useEffect, useState } from "react";
import { useNetworkState } from "../../api/NetworkStateProvider";
import { useAddressBook } from "../../crypto/AddressBookProvider";
import { useCryptoSession } from "../../crypto/CryptoSessionProvider";
import { useDatabase } from "../../db/DatabaseProvider";
import { useEvents } from "../../events/EventsProvider";
import { useLog } from "../../logging/LogProvider";
import type { MenuPosition } from "../shared/Menu";
import { Menu } from "../shared/Menu";
import { MenuItem } from "../shared/MenuItem";
import { PaneMenu } from "../shared/PaneMenu";
import { Window } from "../window/Window";
import { usePeerUserId, useRegisterUserId } from "./DualPaneProvider";
import "./Pane.css";

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString();
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return time.replace(/(\d{2})([ \u202f](?:AM|PM))/i, `$1.${ms}$2`);
}

export function Pane({ className }: { className: string }) {
  const { id, status } = useDatabase();
  const { signingKeyPair, userId, authToken } = useCryptoSession();
  const { entries } = useAddressBook();
  const { events, connected } = useEvents();
  const { online } = useNetworkState();
  const { entries: logEntries } = useLog();
  useRegisterUserId(userId);
  const peerUserId = usePeerUserId();
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const [contextMenu, setContextMenu] = useState<MenuPosition | null>(null);
  const [floatingWindow, setFloatingWindow] = useState<{
    x: number;
    y: number;
  } | null>(null);
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

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const openFloatingWindow = useCallback(() => {
    if (contextMenu) {
      setFloatingWindow({ x: contextMenu.x, y: contextMenu.y });
    }
    setContextMenu(null);
  }, [contextMenu]);

  const closeFloatingWindow = useCallback(() => setFloatingWindow(null), []);

  return (
    <section
      role="application"
      className={className}
      onContextMenu={handleContextMenu}
    >
      <div className="pane-main">
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
        <div className="pane-log">
          {logEntries.map((entry) => (
            <div key={entry.id}>
              [{formatTimestamp(entry.timestamp)}] {entry.message}
            </div>
          ))}
        </div>
        {floatingWindow && (
          <Window
            title="Window"
            initialX={floatingWindow.x}
            initialY={floatingWindow.y}
            onClose={closeFloatingWindow}
          />
        )}
      </div>
      <div className="pane-footer">
        <button type="button" onClick={handleClick}>
          Menu
        </button>
      </div>
      {menu && <PaneMenu position={menu} onClose={closeMenu} />}
      {contextMenu && (
        <Menu position={contextMenu} onClose={closeContextMenu}>
          <MenuItem label="Open Floating Window" onClick={openFloatingWindow} />
        </Menu>
      )}
    </section>
  );
}
