import { useCallback, useMemo, useState } from "react";
import {
  MiniAppBusProvider,
  type MiniAppDefinition,
  type MiniAppId,
} from "../../mini-apps/bus";
import { ContactsApp } from "../../mini-apps/contacts/ContactsApp";
import { ExplorerApp } from "../../mini-apps/explorer/ExplorerApp";
import { IdentityManagerApp } from "../../mini-apps/identity-manager/IdentityManagerApp";
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

const MINI_APPS: Readonly<Record<MiniAppId, MiniAppDefinition>> = {
  contacts: {
    createComponent: () => ContactsApp,
    title: "Contacts",
  },
  explorer: {
    createComponent: () => ExplorerApp,
    title: "Explorer",
  },
  "identity-manager": {
    createComponent: () => IdentityManagerApp,
    initialShowSidebar: false,
    title: "Identity Manager",
  },
  notes: {
    createComponent: () => createNotesWindowComponent(),
    title: "Notes",
  },
  "org-manager": {
    createComponent: () => OrgManagerApp,
    title: "Org Manager",
  },
};

const PANE_MINI_APP_MENU_ITEMS = [
  { appId: "notes", label: "Open Notes" },
  { appId: "contacts", label: "Open Contacts" },
  { appId: "explorer", label: "Open Explorer" },
  { appId: "identity-manager", label: "Open Identity Manager" },
  { appId: "org-manager", label: "Open Org Manager" },
] satisfies ReadonlyArray<{
  appId: MiniAppId;
  label: string;
}>;

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

  const openMiniApp = useCallback(
    (appId: MiniAppId) => {
      if (contextMenu) {
        const definition = MINI_APPS[appId];
        create(
          definition.title,
          contextMenu.x,
          contextMenu.y,
          definition.createComponent(),
          {
            appId,
            initialShowSidebar: definition.initialShowSidebar,
          },
        );
      }
      setContextMenu(null);
    },
    [contextMenu, create],
  );

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
              {PANE_MINI_APP_MENU_ITEMS.map(({ appId, label }) => (
                <MenuItem
                  key={appId}
                  label={label}
                  onClick={() => openMiniApp(appId)}
                />
              ))}
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
      <MiniAppBusProvider miniApps={MINI_APPS}>
        <PaneInner className={className} />
      </MiniAppBusProvider>
    </WindowStateProvider>
  );
}
