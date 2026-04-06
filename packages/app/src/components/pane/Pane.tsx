import { useCallback, useState } from "react";
import { useCryptoSession } from "../../crypto/CryptoSessionProvider";
import { ContactsApp } from "../../mini-apps/contacts/ContactsApp";
import { ExplorerApp } from "../../mini-apps/explorer/ExplorerApp";
import { createNotesWindowComponent } from "../../mini-apps/notes/NotesApp";
import { usePersona } from "../../persona/PersonaProvider";
import type { MenuPosition } from "../shared/Menu";
import { Menu } from "../shared/Menu";
import { MenuItem } from "../shared/MenuItem";
import { Window } from "../window/Window";
import {
  useWindowState,
  WindowStateProvider,
} from "../window/WindowStateProvider";
import { useRegisterUserId } from "./DualPaneProvider";
import "./Pane.css";
import { PaneFooter } from "./PaneFooter";
import { PaneLog } from "./PaneLog";
import { PaneStatus } from "./PaneStatus";

function PaneInner({ className }: { className: string }) {
  const { userId } = useCryptoSession();
  const { signingKeyPair } = usePersona();
  useRegisterUserId(userId);
  const { windows, create } = useWindowState();
  const [contextMenu, setContextMenu] = useState<MenuPosition | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (!signingKeyPair) {
        return;
      }
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    [signingKeyPair],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const openFloatingWindow = useCallback(() => {
    if (contextMenu) {
      create("Window", contextMenu.x, contextMenu.y);
    }
    setContextMenu(null);
  }, [contextMenu, create]);

  const openNotes = useCallback(() => {
    if (contextMenu) {
      create(
        "Notes",
        contextMenu.x,
        contextMenu.y,
        createNotesWindowComponent(),
      );
    }
    setContextMenu(null);
  }, [contextMenu, create]);

  const openContacts = useCallback(() => {
    if (contextMenu) {
      create("Contacts", contextMenu.x, contextMenu.y, ContactsApp);
    }
    setContextMenu(null);
  }, [contextMenu, create]);

  const openExplorer = useCallback(() => {
    if (contextMenu) {
      create("Explorer", contextMenu.x, contextMenu.y, ExplorerApp);
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
        <PaneStatus />
        <PaneLog />
        {!signingKeyPair && (
          <div className="pane-content">
            Generate a key pair from the pane menu to boot this pane.
          </div>
        )}
        {windows.map((w) => (
          <Window key={w.id} windowId={w.id} />
        ))}
      </div>
      <PaneFooter />
      {contextMenu && (
        <Menu position={contextMenu} onClose={closeContextMenu}>
          <MenuItem label="Open Floating Window" onClick={openFloatingWindow} />
          <MenuItem label="Open Notes" onClick={openNotes} />
          <MenuItem label="Open Contacts" onClick={openContacts} />
          <MenuItem label="Open Explorer" onClick={openExplorer} />
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
