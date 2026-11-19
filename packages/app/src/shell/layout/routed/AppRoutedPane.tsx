import { TearleadsLogo } from "@tearleads/ui";
import { RoutedPane } from "@tearleads/windowing";
import { useMemo } from "react";
import { LauncherMiniAppBoundary } from "../../../components/mini-app/MiniAppBoundary";
import { ROUTED_MINI_APP_NAV_ITEMS } from "../../../mini-apps/catalog";
import { SystemMonitorPinned } from "../../../mini-apps/system-monitor/SystemMonitorPinned";
import type { MiniAppId } from "../../../mini-apps/types";
import { useVisibleMiniAppItems } from "../../../mini-apps/useVisibleMiniAppItems";
import { useAppNavigationActions } from "../../../navigation/AppNavigationProvider";
import { useCryptoSession } from "../../../providers/crypto/CryptoSessionProvider";
import { useAppHostConfig } from "../../../providers/host/AppHostConfigProvider";
import { AppSystemTray } from "../../../tray-apps/AppSystemTray";
import {
  usePublishIdentityLink,
  useRegisterUserId,
} from "../../pane/dual-pane";
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
 * logo as its menu button, the system tray's apps in the taskbar's tray, the
 * pinned System Monitor above the active app, and the test-system warning
 * above the taskbar. The launcher offers only the mini-apps the session may
 * see.
 */
export function AppRoutedPane() {
  const { openMiniApp } = useAppNavigationActions();
  const { userId } = useCryptoSession();
  const { subscribeKeyboardVisibility } = useAppHostConfig();
  useRegisterUserId(userId);
  usePublishIdentityLink();
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
      onOpenStartMenuSettings={() =>
        openMiniApp({
          appId: "display-properties",
          pathSegments: ["start-menu"],
        })
      }
      menuIcon={<TearleadsLogo />}
      renderAboveTaskbar={renderTestSystemBanner}
      subscribeKeyboardVisibility={subscribeKeyboardVisibility}
      taskbarTray={<AppSystemTray />}
    />
  );
}
