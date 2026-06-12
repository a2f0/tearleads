import { useCallback, useMemo, useState } from "react";
import {
  MiniAppBusProvider,
  type MiniAppDefinition,
  type MiniAppId,
} from "../../mini-apps/bus";
import { ContactsApp } from "../../mini-apps/contacts/ContactsApp";
import { ExplorerApp } from "../../mini-apps/explorer/ExplorerApp";
import { IdentityManagerApp } from "../../mini-apps/identity-manager/IdentityManagerApp";
import { LocalKeyringUnlockWindow } from "../../mini-apps/LocalKeyringUnlockGate";
import { createNotesWindowComponent } from "../../mini-apps/notes/NotesApp";
import { OrgManagerApp } from "../../mini-apps/org-manager/OrgManagerApp";
import { useCryptoSession } from "../../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../../providers/db/DatabaseProvider";
import { useIdentity } from "../../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../../providers/local-keyring/LocalKeyringLockProvider";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";
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
const LOCKED_PANE_LOG_MESSAGE =
  "Unlock the local keychain to restore this pane.";

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
  const localKeyringLock = useLocalKeyringLock();
  useRegisterUserId(userId);
  const { windows } = useWindowStateData();
  const [contextMenu, setContextMenu] = useState<MenuPosition | null>(null);
  const hasSigningKeyPair = signingKeyPair !== null;
  const paneLocked = localKeyringLock.isLocked && !hasSigningKeyPair;
  const bootPaneLogEntry = useMemo(
    () => ({
      id: "boot-pane-prompt",
      level: "info" as const,
      timestamp: Date.now(),
      message: paneLocked ? LOCKED_PANE_LOG_MESSAGE : BOOT_PANE_LOG_MESSAGE,
    }),
    [paneLocked],
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
        <PaneContextMenu
          hasSigningKeyPair={hasSigningKeyPair}
          paneLocked={paneLocked}
          position={contextMenu}
          onClose={closeContextMenu}
          onGenerateKeyPair={generateKeyPair}
        />
      )}
    </section>
  );
}

function PaneContextMenu({
  hasSigningKeyPair,
  paneLocked,
  position,
  onClose,
  onGenerateKeyPair,
}: {
  hasSigningKeyPair: boolean;
  paneLocked: boolean;
  position: MenuPosition;
  onClose: () => void;
  onGenerateKeyPair: () => void;
}) {
  const { openFloatingWindow, openMiniApp, openUnlockWindow } =
    usePaneWindowMenuActions({ onClose, position });
  const { canLockPane, lockPane } = usePaneLockMenuAction(onClose);

  return (
    <Menu position={position} onClose={onClose}>
      {!hasSigningKeyPair && !paneLocked ? (
        <MenuItem label="Generate Key Pair" onClick={onGenerateKeyPair} />
      ) : (
        <>
          {paneLocked && (
            <MenuItem label="Unlock Database" onClick={openUnlockWindow} />
          )}
          {canLockPane && <MenuItem label="Lock" onClick={lockPane} />}
          <MenuItem label="Open Floating Window" onClick={openFloatingWindow} />
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
  );
}

function usePaneWindowMenuActions({
  position,
  onClose,
}: {
  position: MenuPosition;
  onClose: () => void;
}) {
  const { create } = useWindowActions();

  const openFloatingWindow = useCallback(() => {
    create("Window", position.x, position.y);
    onClose();
  }, [create, onClose, position]);

  const openUnlockWindow = useCallback(() => {
    create(
      "Unlock Database",
      position.x,
      position.y,
      LocalKeyringUnlockWindow,
      { initialShowSidebar: false },
    );
    onClose();
  }, [create, onClose, position]);

  const openMiniApp = useCallback(
    (appId: MiniAppId) => {
      const definition = MINI_APPS[appId];
      create(
        definition.title,
        position.x,
        position.y,
        definition.createComponent(),
        {
          appId,
          initialShowSidebar: definition.initialShowSidebar,
        },
      );
      onClose();
    },
    [create, onClose, position],
  );

  return { openFloatingWindow, openMiniApp, openUnlockWindow };
}

function usePaneLockMenuAction(onClose: () => void) {
  const { clearWorker } = useDatabase();
  const localKeyringLock = useLocalKeyringLock();
  const tearleads = useTearleads();
  const canLockPane =
    localKeyringLock.pinCodeEnabled && !localKeyringLock.isLocked;

  const lockPane = useCallback(() => {
    if (!canLockPane || !localKeyringLock.lock()) {
      onClose();
      return;
    }

    tearleads.session.setContext({
      authToken: null,
      containerId: null,
      isAuthenticated: false,
      organizationId: null,
      userId: null,
    });
    void tearleads.identity
      .setKeyPairs({ encapsulationKeyPair: null, signingKeyPair: null })
      .catch((error: unknown) => {
        tearleads.logError(
          "Failed to clear identity keys while locking",
          error,
        );
      });
    clearWorker();
    onClose();
  }, [canLockPane, clearWorker, localKeyringLock, onClose, tearleads]);

  return { canLockPane, lockPane };
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
