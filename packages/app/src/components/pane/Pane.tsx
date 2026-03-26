import { toFingerprint } from "@tearleads/crypto";
import { isUserEvent } from "@tearleads/validators/event";
import { useCallback, useEffect, useState } from "react";
import { useNetworkState } from "../../api/NetworkStateProvider";
import { useAddressBook } from "../../crypto/AddressBookProvider";
import { useCryptoSession } from "../../crypto/CryptoSessionProvider";
import { useDatabase } from "../../db/DatabaseProvider";
import { useEvents } from "../../events/EventsProvider";
import type { MenuPosition } from "../shared/Menu";
import { Menu } from "../shared/Menu";
import { MenuItem } from "../shared/MenuItem";
import { Window } from "../window/Window";
import {
  useWindowState,
  WindowStateProvider,
} from "../window/WindowStateProvider";
import { usePeerUserId, useRegisterUserId } from "./DualPaneProvider";
import "./Pane.css";
import { PaneFooter } from "./PaneFooter";
import { PaneLog } from "./PaneLog";

function PaneInner({ className }: { className: string }) {
  const { id, status } = useDatabase();
  const { signingKeyPair, userId, authToken } = useCryptoSession();
  const { entries } = useAddressBook();
  const { events, connected } = useEvents();
  const { online } = useNetworkState();
  useRegisterUserId(userId);
  const peerUserId = usePeerUserId();
  const { windows, create } = useWindowState();
  const [contextMenu, setContextMenu] = useState<MenuPosition | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  useEffect(() => {
    if (signingKeyPair) {
      toFingerprint(signingKeyPair.signingPublicKey).then(setFingerprint);
    } else {
      setFingerprint(null);
    }
  }, [signingKeyPair]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const openFloatingWindow = useCallback(() => {
    if (contextMenu) {
      create("Window", contextMenu.x, contextMenu.y);
    }
    setContextMenu(null);
  }, [contextMenu, create]);

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
        <PaneLog />
        {windows.map((w) => (
          <Window key={w.id} windowId={w.id} />
        ))}
      </div>
      <PaneFooter />
      {contextMenu && (
        <Menu position={contextMenu} onClose={closeContextMenu}>
          <MenuItem label="Open Floating Window" onClick={openFloatingWindow} />
        </Menu>
      )}
    </section>
  );
}

export function Pane({ className }: { className: string }) {
  return (
    <WindowStateProvider>
      <PaneInner className={className} />
    </WindowStateProvider>
  );
}
