import { useCallback, useMemo, useState } from "react";
import { MiniAppBusProvider } from "../../mini-apps/bus";
import { LocalKeyringUnlockWindow } from "../../mini-apps/LocalKeyringUnlockGate";
import { MINI_APP_MENU_ITEMS, MINI_APPS } from "../../mini-apps/registry";
import type { MiniAppId } from "../../mini-apps/types";
import type { AppNavigationMode } from "../../navigation/AppNavigationMode";
import {
  AppNavigationProvider,
  useAppNavigationActions,
} from "../../navigation/AppNavigationProvider";
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
          {MINI_APP_MENU_ITEMS.map(({ appId, label }) => (
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
  const { openMiniApp: openMiniAppRoute } = useAppNavigationActions();

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
      openMiniAppRoute({ appId, position, reuseExisting: false });
      onClose();
    },
    [onClose, openMiniAppRoute, position],
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

export function Pane({
  className,
  navigationMode = "windowed",
}: {
  className: string;
  navigationMode?: AppNavigationMode | undefined;
}) {
  return (
    <WindowStateProvider>
      <AppNavigationProvider mode={navigationMode} miniApps={MINI_APPS}>
        <MiniAppBusProvider>
          <PaneInner className={className} />
        </MiniAppBusProvider>
      </AppNavigationProvider>
    </WindowStateProvider>
  );
}
