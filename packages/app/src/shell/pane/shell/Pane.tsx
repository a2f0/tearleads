import {
  type MenuPosition,
  MiniAppWindow,
  type NavigationMode,
  useActiveLauncherRoute,
  useWindowStateData,
  WindowStateProvider,
} from "@tearleads/windowing";
import { type MouseEvent, type ReactNode, useCallback, useState } from "react";
import { LauncherMiniAppBoundary } from "../../../components/mini-app/MiniAppBoundary";
import {
  MiniAppBusProvider,
  useMiniAppBusActions,
} from "../../../mini-apps/bus";
import { useRegisterMiniAppLauncher } from "../../../mini-apps/miniAppLauncher";
import { MINI_APP_LAUNCHER } from "../../../mini-apps/registry";
import { SystemMonitorLauncherButton } from "../../../mini-apps/system-monitor/SystemMonitorLauncherButton";
import { SystemMonitorPinned } from "../../../mini-apps/system-monitor/SystemMonitorPinned";
import { SystemMonitorProvider } from "../../../mini-apps/system-monitor/SystemMonitorProvider";
import { AppNavigationProvider } from "../../../navigation/AppNavigationProvider";
import { NavigationModeSwitch } from "../../../navigation/NavigationModeSwitch";
import { useCryptoSession } from "../../../providers/crypto/CryptoSessionProvider";
import { AppFeatureFlagsProvider } from "../../../providers/feature-flags/AppFeatureFlagsProvider";
import { ThemeToggleButton } from "../../../theme/ThemeToggleButton";
import { AppRoutedPane } from "../../layout/routed/AppRoutedPane";
import { TestSystemBanner } from "../../layout/TestSystemBanner";
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
            <MiniAppWindow
              key={w.id}
              AppBoundary={LauncherMiniAppBoundary}
              windowId={w.id}
            />
          ))}
        </div>
        <TestSystemBanner />
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
  const activeRoute = useActiveLauncherRoute(MINI_APP_LAUNCHER);
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
  navigationMode?: NavigationMode | undefined;
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
        <AppRoutedPane />
      </SystemMonitorProvider>
    ) : null;
  }

  return (
    <AppFeatureFlagsProvider>
      <WindowStateProvider>
        <AppNavigationProvider
          mode={navigationMode}
          launcher={MINI_APP_LAUNCHER}
        >
          <MiniAppBusProvider>
            <PaneMiniAppLauncherBridge active={active} />
            {surface}
          </MiniAppBusProvider>
        </AppNavigationProvider>
      </WindowStateProvider>
    </AppFeatureFlagsProvider>
  );
}
