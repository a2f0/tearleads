import { type MouseEvent, type ReactNode, useCallback, useState } from "react";
import { MiniAppBusProvider } from "../../../mini-apps/bus";
import { MINI_APPS } from "../../../mini-apps/registry";
import type { AppNavigationMode } from "../../../navigation/AppNavigationMode";
import { AppNavigationProvider } from "../../../navigation/AppNavigationProvider";
import { useCryptoSession } from "../../../providers/crypto/CryptoSessionProvider";
import { useIdentity } from "../../../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../../../providers/local-keyring/LocalKeyringLockProvider";
import { RoutedPane } from "../../layout/routed/RoutedPane";
import type { MenuPosition } from "../../shared/Menu";
import { Window } from "../../window/Window";
import {
  useWindowStateData,
  WindowStateProvider,
} from "../../window/WindowStateProvider";
import { useRegisterUserId } from "../DualPaneProvider";
import { useBootPaneLogEntries } from "../log/useBootPaneLogEntries";
import { PaneFooter } from "../PaneFooter";
import { PaneLog } from "../PaneLog";
import { PaneStatus } from "../PaneStatus";
import "./Pane.css";
import { PaneContextMenu } from "./PaneContextMenu";

const BOOT_PANE_LOG_MESSAGE =
  "Generate a key pair from the pane menu to boot this pane.";

function PaneInner({ className }: { className: string }) {
  const { userId } = useCryptoSession();
  const { generateKey, signingKeyPair } = useIdentity();
  const localKeyringLock = useLocalKeyringLock();
  useRegisterUserId(userId);
  const { windows } = useWindowStateData();
  const [contextMenu, setContextMenu] = useState<MenuPosition | null>(null);
  const hasSigningKeyPair = signingKeyPair !== null;
  const paneLocked = localKeyringLock.isLocked && !hasSigningKeyPair;
  const trailingLogEntries = useBootPaneLogEntries({
    bootMessage: BOOT_PANE_LOG_MESSAGE,
    hasSigningKeyPair,
    paneLocked,
  });

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
  routedVisible = false,
}: {
  className: string;
  navigationMode?: AppNavigationMode | undefined;
  // In routed mode only the single active pane shows the routed shell; the
  // other (always-mounted, runtime-bearing) panes render no surface.
  routedVisible?: boolean | undefined;
}) {
  // Swap only the leaf surface by mode; the provider stack above stays mounted
  // so the pane's runtime is never torn down when the layout toggles.
  let surface: ReactNode = <PaneInner className={className} />;
  if (navigationMode === "routed") {
    surface = routedVisible ? <RoutedPane /> : null;
  }

  return (
    <WindowStateProvider>
      <AppNavigationProvider mode={navigationMode} miniApps={MINI_APPS}>
        <MiniAppBusProvider>{surface}</MiniAppBusProvider>
      </AppNavigationProvider>
    </WindowStateProvider>
  );
}
