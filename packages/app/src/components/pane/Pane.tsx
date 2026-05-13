import { useCallback, useMemo, useState } from "react";
import { ContactsApp } from "../../mini-apps/contacts/ContactsApp";
import { ExplorerApp } from "../../mini-apps/explorer/ExplorerApp";
import { createNotesWindowComponent } from "../../mini-apps/notes/NotesApp";
import { OrgManagerApp } from "../../mini-apps/org-manager/OrgManagerApp";
import { useCryptoSession } from "../../providers/crypto/CryptoSessionProvider";
import { useIdentity } from "../../providers/identity/IdentityProvider";
import type { MenuPosition } from "../shared/Menu";
import { Menu } from "../shared/Menu";
import { MenuItem } from "../shared/MenuItem";
import { Window } from "../window/Window";
import {
  useWindowActions,
  useWindowStateData,
  WindowStateProvider,
} from "../window/WindowStateProvider";
import { useRegisterUserId } from "./DualPaneProvider";
import "./Pane.css";
import { PaneFooter } from "./PaneFooter";
import { PaneLog } from "./PaneLog";
import { PaneStatus } from "./PaneStatus";

const BOOT_PANE_LOG_MESSAGE =
  "Generate a key pair from the pane menu to boot this pane.";

function PaneInner({ className }: { className: string }) {
  const { userId } = useCryptoSession();
  const { generateKey, signingKeyPair } = useIdentity();
  useRegisterUserId(userId);
  const { windows } = useWindowStateData();
  const { create } = useWindowActions();
  const [contextMenu, setContextMenu] = useState<MenuPosition | null>(null);
  const hasSigningKeyPair = signingKeyPair !== null;
  const bootPaneLogEntry = useMemo(
    () => ({
      id: "boot-pane-prompt",
      level: "info" as const,
      timestamp: Date.now(),
      message: BOOT_PANE_LOG_MESSAGE,
    }),
    [hasSigningKeyPair],
  );
  const trailingLogEntries = useMemo(
    () => (hasSigningKeyPair ? [] : [bootPaneLogEntry]),
    [bootPaneLogEntry, hasSigningKeyPair],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const generateKeyPair = useCallback(() => {
    generateKey();
    setContextMenu(null);
  }, [generateKey]);

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

  const openOrgManager = useCallback(() => {
    if (contextMenu) {
      create("Org Manager", contextMenu.x, contextMenu.y, OrgManagerApp);
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
        <PaneLog trailingEntries={trailingLogEntries} />
        {windows.map((w) => (
          <Window key={w.id} windowId={w.id} />
        ))}
      </div>
      <PaneFooter />
      {contextMenu && (
        <Menu position={contextMenu} onClose={closeContextMenu}>
          {!hasSigningKeyPair ? (
            <MenuItem label="Generate Key Pair" onClick={generateKeyPair} />
          ) : (
            <>
              <MenuItem
                label="Open Floating Window"
                onClick={openFloatingWindow}
              />
              <MenuItem label="Open Notes" onClick={openNotes} />
              <MenuItem label="Open Contacts" onClick={openContacts} />
              <MenuItem label="Open Explorer" onClick={openExplorer} />
              <MenuItem label="Open Org Manager" onClick={openOrgManager} />
            </>
          )}
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
