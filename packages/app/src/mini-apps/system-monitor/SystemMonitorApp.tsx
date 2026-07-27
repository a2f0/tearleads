import { PushPinIcon } from "@phosphor-icons/react/dist/csr/PushPin";
import { useCallback, useId, useMemo, useState } from "react";
import {
  MiniAppRoot,
  type MiniAppTabDescriptor,
  MiniAppTabList,
  MiniAppTabPanel,
} from "../../components/mini-app/MiniAppLayout";
import { PaneStatus } from "../../components/pane/status/PaneStatus";
import { useNetworkModeContextMenu } from "../../components/shared/NetworkModeContextMenu";
import { useCurrentWindow } from "../../components/window/CurrentWindowContext";
import {
  useWindowTitleBarAction,
  useWindowViewMenuItem,
} from "../../components/window/WindowMenuContext";
import {
  useAppNavigationState,
  useMiniAppRouteSegments,
} from "../../navigation/AppNavigationProvider";
import "./SystemMonitor.css";
import {
  DEFAULT_SYSTEM_MONITOR_TAB,
  formatSystemMonitorRouteSegments,
  parseSystemMonitorRouteSegments,
  type SystemMonitorTabId,
} from "./routes";
import { SystemMonitorEnvironment } from "./SystemMonitorEnvironment";
import { SystemMonitorFeatureFlags } from "./SystemMonitorFeatureFlags";
import { SystemMonitorLog } from "./SystemMonitorLog";
import { useSystemMonitor } from "./SystemMonitorProvider";
import { useSystemMonitorCopyReportAction } from "./useSystemMonitorCopyReportAction";
import { useSystemMonitorReport } from "./useSystemMonitorReport";
import { useSystemMonitorWorkerActions } from "./useSystemMonitorWorkerActions";

type SystemMonitorTab = MiniAppTabDescriptor<SystemMonitorTabId>;

const BASE_SYSTEM_MONITOR_TABS: ReadonlyArray<SystemMonitorTab> = [
  { id: "logs", label: "Logs" },
  { id: "status", label: "Status" },
  { id: "environment", label: "Environment" },
];

const DEVELOPER_SYSTEM_MONITOR_TABS: ReadonlyArray<SystemMonitorTab> = [
  ...BASE_SYSTEM_MONITOR_TABS,
  { id: "feature-flags", label: "Feature Flags" },
];

function getSystemMonitorTabs(
  isDeveloperMode: boolean,
): ReadonlyArray<SystemMonitorTab> {
  return isDeveloperMode
    ? DEVELOPER_SYSTEM_MONITOR_TABS
    : BASE_SYSTEM_MONITOR_TABS;
}

function isVisibleSystemMonitorTab(
  tabId: SystemMonitorTabId,
  tabs: ReadonlyArray<SystemMonitorTab>,
): boolean {
  return tabs.some((tab) => tab.id === tabId);
}

function renderSystemMonitorTabPanel(activeTab: SystemMonitorTabId) {
  switch (activeTab) {
    case "environment":
      return <SystemMonitorEnvironment />;
    case "feature-flags":
      return <SystemMonitorFeatureFlags />;
    case "status":
      return <PaneStatus />;
    case "logs":
      return <SystemMonitorLog />;
  }
}

const PIN_TO_DESKTOP_LABEL = "Pin to Desktop";
const ENABLE_DEVELOPER_MODE_LABEL = "Enable Developer Mode";
const DISABLE_DEVELOPER_MODE_LABEL = "Disable Developer Mode";

const SYSTEM_MONITOR_TABS_LABEL = "System Monitor sections";

function useSystemMonitorChromeActions() {
  const { canPin, isDeveloperMode, pinToDesktop, toggleDeveloperMode } =
    useSystemMonitor();
  const currentWindow = useCurrentWindow();
  const { mode: navigationMode } = useAppNavigationState();
  const isRoutedShell = navigationMode === "routed";

  const handlePin = useCallback(() => {
    pinToDesktop();
    currentWindow?.close();
  }, [currentWindow, pinToDesktop]);

  // Surface the pin action only where a pane-level SystemMonitorProvider is
  // mounted and the app is using the windowed shell. Routed mobile and tablet
  // layouts do not have a desktop surface to pin the monitor to.
  // Memoized so the registrations keep a stable identity across renders.
  const pinMenuItem = useMemo(
    () =>
      canPin && !isRoutedShell
        ? {
            id: "system-monitor-pin",
            label: PIN_TO_DESKTOP_LABEL,
            onClick: handlePin,
          }
        : null,
    [canPin, handlePin, isRoutedShell],
  );
  const developerModeLabel = isDeveloperMode
    ? DISABLE_DEVELOPER_MODE_LABEL
    : ENABLE_DEVELOPER_MODE_LABEL;
  const developerModeViewMenuItem = useMemo(
    () =>
      canPin && !isRoutedShell
        ? {
            id: "system-monitor-developer-mode",
            label: developerModeLabel,
            onClick: toggleDeveloperMode,
            priority: -10,
          }
        : null,
    [canPin, developerModeLabel, isRoutedShell, toggleDeveloperMode],
  );
  const pinTitleBarAction = useMemo(
    () =>
      canPin && !isRoutedShell
        ? {
            icon: <PushPinIcon aria-hidden size={14} />,
            id: "system-monitor-pin",
            label: PIN_TO_DESKTOP_LABEL,
            onClick: handlePin,
          }
        : null,
    [canPin, handlePin, isRoutedShell],
  );
  useWindowViewMenuItem(pinMenuItem);
  useWindowViewMenuItem(developerModeViewMenuItem);
  useWindowTitleBarAction(pinTitleBarAction);
}

export function SystemMonitorApp() {
  const { isRouted, pathSegments, setPathSegments } =
    useMiniAppRouteSegments("system-monitor");
  const { isDeveloperMode } = useSystemMonitor();
  const visibleTabs = getSystemMonitorTabs(isDeveloperMode);
  const [localActiveTab, setLocalActiveTab] = useState<SystemMonitorTabId>(
    DEFAULT_SYSTEM_MONITOR_TAB,
  );
  const requestedActiveTab = isRouted
    ? parseSystemMonitorRouteSegments(pathSegments)
    : localActiveTab;
  const activeTab = isVisibleSystemMonitorTab(requestedActiveTab, visibleTabs)
    ? requestedActiveTab
    : DEFAULT_SYSTEM_MONITOR_TAB;
  const idPrefix = useId();
  const setActiveTab = useCallback(
    (nextTab: SystemMonitorTabId) => {
      if (isRouted) {
        setPathSegments(formatSystemMonitorRouteSegments(nextTab));
        return;
      }

      setLocalActiveTab(nextTab);
    },
    [isRouted, setPathSegments],
  );
  const networkContextMenu = useNetworkModeContextMenu();
  // Feature flags reach the report only when developer mode surfaces their tab,
  // so a report covers exactly the tabs the user could see.
  const buildReport = useSystemMonitorReport({
    includeFeatureFlags: isDeveloperMode,
  });
  useSystemMonitorCopyReportAction(buildReport);
  useSystemMonitorChromeActions();
  useSystemMonitorWorkerActions();

  return (
    <MiniAppRoot
      className="system-monitor"
      onContextMenu={networkContextMenu.handleContextMenu}
    >
      <MiniAppTabList
        activeTab={activeTab}
        idPrefix={idPrefix}
        label={SYSTEM_MONITOR_TABS_LABEL}
        onSelect={setActiveTab}
        tabs={visibleTabs}
      />
      <MiniAppTabPanel
        activeTab={activeTab}
        className="system-monitor-tab-panel"
        idPrefix={idPrefix}
      >
        {renderSystemMonitorTabPanel(activeTab)}
      </MiniAppTabPanel>
      {networkContextMenu.contextMenu}
    </MiniAppRoot>
  );
}
