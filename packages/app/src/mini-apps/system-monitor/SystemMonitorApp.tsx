import { PushPinIcon } from "@phosphor-icons/react/dist/csr/PushPin";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useId,
  useMemo,
  useState,
} from "react";
import { PaneStatus } from "../../components/pane/PaneStatus";
import {
  MiniAppButton,
  MiniAppRoot,
} from "../../components/shared/MiniAppLayout";
import { useCurrentWindow } from "../../components/window/CurrentWindowContext";
import {
  useWindowFileMenuItem,
  useWindowTitleBarAction,
  useWindowViewMenuItem,
} from "../../components/window/WindowMenuContext";
import {
  useAppNavigationActions,
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
import { SystemMonitorFeatureFlags } from "./SystemMonitorFeatureFlags";
import { SystemMonitorLog } from "./SystemMonitorLog";
import { useSystemMonitor } from "./SystemMonitorProvider";

interface SystemMonitorTab {
  id: SystemMonitorTabId;
  label: string;
}

const BASE_SYSTEM_MONITOR_TABS: ReadonlyArray<SystemMonitorTab> = [
  { id: "logs", label: "Logs" },
  { id: "status", label: "Status" },
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
    case "feature-flags":
      return <SystemMonitorFeatureFlags />;
    case "status":
      return <PaneStatus />;
    case "logs":
      return <SystemMonitorLog />;
  }
}

const PIN_TO_DESKTOP_LABEL = "Pin to Desktop";
const PIN_TO_HOME_SCREEN_LABEL = "Pin to Home Screen";
const ENABLE_DEVELOPER_MODE_LABEL = "Enable Developer Mode";
const DISABLE_DEVELOPER_MODE_LABEL = "Disable Developer Mode";

// Roving tabindex per the WAI-ARIA tab pattern: only the active tab is in the
// tab order; arrow/Home/End keys move focus (and selection) between tabs.
function SystemMonitorTabs({
  activeTab,
  idPrefix,
  onSelect,
  tabs,
}: {
  activeTab: SystemMonitorTabId;
  idPrefix: string;
  onSelect: (tab: SystemMonitorTabId) => void;
  tabs: ReadonlyArray<SystemMonitorTab>;
}) {
  const handleTabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const lastIndex = tabs.length - 1;
      const currentIndex = tabs.findIndex((tab) => tab.id === activeTab);
      let nextIndex: number;
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          nextIndex = currentIndex >= lastIndex ? 0 : currentIndex + 1;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = lastIndex;
          break;
        default:
          return;
      }
      const nextTab = tabs[nextIndex];
      if (!nextTab) {
        return;
      }
      event.preventDefault();
      onSelect(nextTab.id);
      document.getElementById(`${idPrefix}-${nextTab.id}-tab`)?.focus();
    },
    [activeTab, idPrefix, onSelect, tabs],
  );

  return (
    <div
      aria-label="System Monitor sections"
      className="system-monitor-tabs"
      role="tablist"
    >
      {tabs.map((tab) => (
        <MiniAppButton
          aria-controls={`${idPrefix}-${tab.id}-panel`}
          aria-selected={activeTab === tab.id}
          className="system-monitor-tab"
          id={`${idPrefix}-${tab.id}-tab`}
          key={tab.id}
          role="tab"
          tabIndex={activeTab === tab.id ? 0 : -1}
          variant="ghost"
          onClick={() => {
            onSelect(tab.id);
          }}
          onKeyDown={handleTabKeyDown}
        >
          {tab.label}
        </MiniAppButton>
      ))}
    </div>
  );
}

function useSystemMonitorChromeActions() {
  const { canPin, isDeveloperMode, pinToDesktop, toggleDeveloperMode } =
    useSystemMonitor();
  const currentWindow = useCurrentWindow();
  const { navigateHome } = useAppNavigationActions();
  const { mode: navigationMode } = useAppNavigationState();
  const isRoutedShell = navigationMode === "routed";

  const handlePin = useCallback(() => {
    pinToDesktop();
    if (isRoutedShell) {
      navigateHome();
      return;
    }

    currentWindow?.close();
  }, [currentWindow, isRoutedShell, navigateHome, pinToDesktop]);

  const pinLabel = isRoutedShell
    ? PIN_TO_HOME_SCREEN_LABEL
    : PIN_TO_DESKTOP_LABEL;

  // Surface the pin action only where a pane-level SystemMonitorProvider is
  // mounted. Windowed mode keeps the existing View/title-bar action; routed
  // mode exposes the equivalent home-screen action through the File actions
  // surfaced by the routed rail/drawer.
  // Memoized so the registrations keep a stable identity across renders.
  const pinMenuItem = useMemo(
    () =>
      canPin
        ? {
            id: "system-monitor-pin",
            label: pinLabel,
            onClick: handlePin,
          }
        : null,
    [canPin, handlePin, pinLabel],
  );
  const pinFileMenuItem = useMemo(
    () => (isRoutedShell ? pinMenuItem : null),
    [isRoutedShell, pinMenuItem],
  );
  const pinViewMenuItem = useMemo(
    () => (isRoutedShell ? null : pinMenuItem),
    [isRoutedShell, pinMenuItem],
  );
  const developerModeViewMenuItem = useMemo(
    () =>
      canPin
        ? {
            id: "system-monitor-developer-mode",
            label: isDeveloperMode
              ? DISABLE_DEVELOPER_MODE_LABEL
              : ENABLE_DEVELOPER_MODE_LABEL,
            onClick: toggleDeveloperMode,
            priority: -10,
          }
        : null,
    [canPin, isDeveloperMode, toggleDeveloperMode],
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
  useWindowFileMenuItem(pinFileMenuItem);
  useWindowViewMenuItem(pinViewMenuItem);
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
  useSystemMonitorChromeActions();

  return (
    <MiniAppRoot className="system-monitor">
      <SystemMonitorTabs
        activeTab={activeTab}
        idPrefix={idPrefix}
        onSelect={setActiveTab}
        tabs={visibleTabs}
      />
      <div
        aria-labelledby={`${idPrefix}-${activeTab}-tab`}
        className="system-monitor-tab-panel"
        id={`${idPrefix}-${activeTab}-panel`}
        role="tabpanel"
      >
        {renderSystemMonitorTabPanel(activeTab)}
      </div>
    </MiniAppRoot>
  );
}
