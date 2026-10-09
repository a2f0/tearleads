import { TearleadsLogo } from "@tearleads/ui";
import { RoutedPane } from "@tearleads/windowing";
import { useMemo } from "react";
import { LauncherMiniAppBoundary } from "../../../components/mini-app/MiniAppBoundary";
import { ROUTED_MINI_APP_NAV_ITEMS } from "../../../mini-apps/catalog";
import { SystemMonitorPinned } from "../../../mini-apps/system-monitor/SystemMonitorPinned";
import type { MiniAppId } from "../../../mini-apps/types";
import { useVisibleMiniAppItems } from "../../../mini-apps/useVisibleMiniAppItems";
import { NavigationModeSwitch } from "../../../navigation/NavigationModeSwitch";
import { useCryptoSession } from "../../../providers/crypto/CryptoSessionProvider";
import { useAppHostConfig } from "../../../providers/host/AppHostConfigProvider";
import { useRegisterUserId } from "../../pane/dual-pane";
import { SyncStatusIndicator } from "../../pane/footer/sync-status/SyncStatusIndicator";
import { TestSystemBanner } from "../TestSystemBanner";
import "./AppRoutedPane.css";

const LAUNCHER_PLACEMENT_STORAGE_KEY = "tearleads.launcher.placement";

function renderTestSystemBanner({
  keyboardVisible,
}: {
  keyboardVisible: boolean;
}) {
  return <TestSystemBanner hidden={keyboardVisible} />;
}

/**
 * The windowing package's routed shell with the app's chrome: the Tearleads
 * logo as its menu button, the windowed/routed switch and sync status in the
 * taskbar's tray, the pinned System Monitor above the active app, and the
 * test-system warning above the taskbar. The launcher offers only the
 * mini-apps the session may see.
 */
export function AppRoutedPane() {
  const { userId } = useCryptoSession();
  const { navigationMode, subscribeKeyboardVisibility } = useAppHostConfig();
  useRegisterUserId(userId);
  const visibleNavItems = useVisibleMiniAppItems(ROUTED_MINI_APP_NAV_ITEMS);
  const appIds = useMemo<ReadonlyArray<MiniAppId>>(
    () => visibleNavItems.map(({ appId }) => appId),
    [visibleNavItems],
  );

  return (
    <RoutedPane
      AppBoundary={LauncherMiniAppBoundary}
      appIds={appIds}
      contentTop={<SystemMonitorPinned />}
      launcherPlacementStorageKey={LAUNCHER_PLACEMENT_STORAGE_KEY}
      menuIcon={<TearleadsLogo />}
      renderAboveTaskbar={renderTestSystemBanner}
      subscribeKeyboardVisibility={subscribeKeyboardVisibility}
      taskbarTray={
        <>
          <NavigationModeSwitch
            allowWindowed={navigationMode === "windowed"}
            mode="routed"
          />
          <SyncStatusIndicator />
        </>
      }
    />
  );
}
