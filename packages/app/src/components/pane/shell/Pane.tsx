import { type MouseEvent, type ReactNode, useCallback, useState } from "react";
import { MiniAppBusProvider } from "../../../mini-apps/bus";
import { MINI_APPS } from "../../../mini-apps/registry";
import { SystemMonitorLauncherButton } from "../../../mini-apps/system-monitor/SystemMonitorLauncherButton";
import { SystemMonitorPinned } from "../../../mini-apps/system-monitor/SystemMonitorPinned";
import { SystemMonitorProvider } from "../../../mini-apps/system-monitor/SystemMonitorProvider";
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
import { PaneFooter } from "../PaneFooter";
import "./Pane.css";
import { PaneContextMenu } from "./PaneContextMenu";

function PaneInner({ className }: { className: string }) {
  const { userId } = useCryptoSession();
  const { generateKey, signingKeyPair } = useIdentity();
  const localKeyringLock = useLocalKeyringLock();
  useRegisterUserId(userId);
  const { windows } = useWindowStateData();
  const [contextMenu, setContextMenu] = useState<MenuPosition | null>(null);
  const hasSigningKeyPair = signingKeyPair !== null;
  const paneLocked = localKeyringLock.isLocked && !hasSigningKeyPair;

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
      <SystemMonitorProvider>
        <div className="pane-main">
          <SystemMonitorPinned />
          {windows.map((w) => (
            <Window key={w.id} windowId={w.id} />
          ))}
        </div>
        <PaneFooter tray={<SystemMonitorLauncherButton />} />
      </SystemMonitorProvider>
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
    surface = routedVisible ? (
      <SystemMonitorProvider>
        <RoutedPane />
      </SystemMonitorProvider>
    ) : null;
  }

  return (
    <WindowStateProvider>
      <AppNavigationProvider mode={navigationMode} miniApps={MINI_APPS}>
        <MiniAppBusProvider>{surface}</MiniAppBusProvider>
      </AppNavigationProvider>
    </WindowStateProvider>
  );
}
