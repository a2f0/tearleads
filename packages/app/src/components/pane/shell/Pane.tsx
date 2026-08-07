import { type MouseEvent, type ReactNode, useCallback, useState } from "react";
import {
  MiniAppBusProvider,
  useMiniAppBusActions,
} from "../../../mini-apps/bus";
import { useRegisterMiniAppLauncher } from "../../../mini-apps/miniAppLauncher";
import { MINI_APPS } from "../../../mini-apps/registry";
import { SystemMonitorLauncherButton } from "../../../mini-apps/system-monitor/SystemMonitorLauncherButton";
import { SystemMonitorPinned } from "../../../mini-apps/system-monitor/SystemMonitorPinned";
import { SystemMonitorProvider } from "../../../mini-apps/system-monitor/SystemMonitorProvider";
import type { AppNavigationMode } from "../../../navigation/AppNavigationMode";
import { AppNavigationProvider } from "../../../navigation/AppNavigationProvider";
import { NavigationModeSwitch } from "../../../navigation/NavigationModeSwitch";
import { useActiveAppRoute } from "../../../navigation/useActiveAppRoute";
import { useCryptoSession } from "../../../providers/crypto/CryptoSessionProvider";
import { AppFeatureFlagsProvider } from "../../../providers/feature-flags/AppFeatureFlagsProvider";
import { ThemeToggleButton } from "../../../theme/ThemeToggleButton";
import { RoutedPane } from "../../layout/routed/RoutedPane";
import type { MenuPosition } from "../../shared/Menu";
import { Window } from "../../window/Window";
import {
  useWindowStateData,
  WindowStateProvider,
} from "../../window/WindowStateProvider";
import { useRegisterUserId } from "../dual-pane";
import { PaneFooter } from "../footer/PaneFooter";
import { SyncStatusIndicator } from "../footer/sync-status/SyncStatusIndicator";
import "./Pane.css";
import { PaneMenu } from "./PaneMenu";

function PaneInner({
  className,
  desktopLabel,
}: {
  className: string;
  desktopLabel?: string | undefined;
}) {
  const { userId } = useCryptoSession();
  useRegisterUserId(userId);
  const { windows } = useWindowStateData();
  const [contextMenu, setContextMenu] = useState<MenuPosition | null>(null);

  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  return (
    <section
      role="application"
      className={className}
      onContextMenu={handleContextMenu}
    >
      <SystemMonitorProvider>
        <div className="pane-main">
          {desktopLabel && (
            <div aria-hidden="true" className="pane-desktop-label">
              {desktopLabel}
            </div>
          )}
          <SystemMonitorPinned />
          {windows.map((w) => (
            <Window key={w.id} windowId={w.id} />
          ))}
        </div>
        <PaneFooter
          tray={
            <>
              <ThemeToggleButton />
              <NavigationModeSwitch mode="windowed" />
              <SystemMonitorLauncherButton />
              <SyncStatusIndicator />
            </>
          }
        />
        {contextMenu && (
          <PaneMenu position={contextMenu} onClose={closeContextMenu} />
        )}
      </SystemMonitorProvider>
    </section>
  );
}

// Publishes this pane's `openMiniApp` as the app-shell launcher while the pane
// is the active (visible) one, so shell chrome above the panes (the billing
// banner) can open a mini-app in it. Lives inside MiniAppBusProvider so it can
// read the bus; renders nothing.
function PaneMiniAppLauncherBridge({ active }: { active: boolean }) {
  const { openMiniApp } = useMiniAppBusActions();
  const activeRoute = useActiveAppRoute();
  useRegisterMiniAppLauncher(openMiniApp, active, activeRoute);
  return null;
}

export function Pane({
  active = false,
  className,
  desktopLabel,
  navigationMode = "windowed",
  routedVisible = false,
}: {
  active?: boolean | undefined;
  className: string;
  desktopLabel?: string | undefined;
  navigationMode?: AppNavigationMode | undefined;
  // In routed mode only the single active pane shows the routed shell; the
  // other (always-mounted, runtime-bearing) panes render no surface.
  routedVisible?: boolean | undefined;
}) {
  // Swap only the leaf surface by mode; the provider stack above stays mounted
  // so the pane's runtime is never torn down when the layout toggles.
  let surface: ReactNode = (
    <PaneInner className={className} desktopLabel={desktopLabel} />
  );
  if (navigationMode === "routed") {
    surface = routedVisible ? (
      <SystemMonitorProvider>
        <RoutedPane />
      </SystemMonitorProvider>
    ) : null;
  }

  return (
    <AppFeatureFlagsProvider>
      <WindowStateProvider>
        <AppNavigationProvider mode={navigationMode} miniApps={MINI_APPS}>
          <MiniAppBusProvider>
            <PaneMiniAppLauncherBridge active={active} />
            {surface}
          </MiniAppBusProvider>
        </AppNavigationProvider>
      </WindowStateProvider>
    </AppFeatureFlagsProvider>
  );
}
