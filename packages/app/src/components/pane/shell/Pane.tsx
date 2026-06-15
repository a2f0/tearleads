import { type MouseEvent, useCallback, useMemo, useState } from "react";
import { MiniAppBusProvider } from "../../../mini-apps/bus";
import { MINI_APPS } from "../../../mini-apps/registry";
import type { AppNavigationMode } from "../../../navigation/AppNavigationMode";
import { AppNavigationProvider } from "../../../navigation/AppNavigationProvider";
import { useCryptoSession } from "../../../providers/crypto/CryptoSessionProvider";
import { useIdentity } from "../../../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../../../providers/local-keyring/LocalKeyringLockProvider";
import type { MenuPosition } from "../../shared/Menu";
import { Window } from "../../window/Window";
import {
  useWindowStateData,
  WindowStateProvider,
} from "../../window/WindowStateProvider";
import { useRegisterUserId } from "../DualPaneProvider";
import { PaneFooter } from "../PaneFooter";
import { PaneLog } from "../PaneLog";
import { PaneStatus } from "../PaneStatus";
import "./Pane.css";
import { PaneContextMenu } from "./PaneContextMenu";

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

  const handleContextMenu = useCallback((e: MouseEvent) => {
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
