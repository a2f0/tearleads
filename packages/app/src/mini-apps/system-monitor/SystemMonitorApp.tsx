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
import { SystemMonitorLog } from "./SystemMonitorLog";
import { useSystemMonitor } from "./SystemMonitorProvider";

const SYSTEM_MONITOR_TABS: ReadonlyArray<{
  id: SystemMonitorTabId;
  label: string;
}> = [
  { id: "logs", label: "Logs" },
  { id: "status", label: "Status" },
];

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
}: {
  activeTab: SystemMonitorTabId;
  idPrefix: string;
  onSelect: (tab: SystemMonitorTabId) => void;
}) {
  const handleTabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const lastIndex = SYSTEM_MONITOR_TABS.length - 1;
      const currentIndex = SYSTEM_MONITOR_TABS.findIndex(
        (tab) => tab.id === activeTab,
      );
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
      const nextTab = SYSTEM_MONITOR_TABS[nextIndex];
      if (!nextTab) {
        return;
      }
      event.preventDefault();
      onSelect(nextTab.id);
      document.getElementById(`${idPrefix}-${nextTab.id}-tab`)?.focus();
    },
    [activeTab, idPrefix, onSelect],
  );

  return (
    <div
      aria-label="System Monitor sections"
      className="system-monitor-tabs"
      role="tablist"
    >
      {SYSTEM_MONITOR_TABS.map((tab) => (
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
  const [localActiveTab, setLocalActiveTab] = useState<SystemMonitorTabId>(
    DEFAULT_SYSTEM_MONITOR_TAB,
  );
  const activeTab = isRouted
    ? parseSystemMonitorRouteSegments(pathSegments)
    : localActiveTab;
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
      />
      <div
        aria-labelledby={`${idPrefix}-${activeTab}-tab`}
        className="system-monitor-tab-panel"
        id={`${idPrefix}-${activeTab}-panel`}
        role="tabpanel"
      >
        {activeTab === "logs" ? <SystemMonitorLog /> : <PaneStatus />}
      </div>
    </MiniAppRoot>
  );
}
