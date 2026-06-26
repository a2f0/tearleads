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
  useWindowTitleBarAction,
  useWindowViewMenuItem,
} from "../../components/window/WindowMenuContext";
import { useMiniAppRouteSegments } from "../../navigation/AppNavigationProvider";
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
  const { canPin, pinToDesktop } = useSystemMonitor();
  const currentWindow = useCurrentWindow();
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

  const handlePin = useCallback(() => {
    pinToDesktop();
    currentWindow?.close();
  }, [pinToDesktop, currentWindow]);

  // Surface the same action in the window's View menu and title bar, but only where pinning
  // is meaningful (the windowed home pane that mounts SystemMonitorProvider).
  // Memoized so the registrations keep a stable identity across renders.
  const pinMenuItem = useMemo(
    () =>
      canPin
        ? {
            id: "system-monitor-pin",
            label: PIN_TO_DESKTOP_LABEL,
            onClick: handlePin,
          }
        : null,
    [canPin, handlePin],
  );
  const pinTitleBarAction = useMemo(
    () =>
      canPin
        ? {
            icon: <PushPinIcon aria-hidden size={14} />,
            id: "system-monitor-pin",
            label: PIN_TO_DESKTOP_LABEL,
            onClick: handlePin,
          }
        : null,
    [canPin, handlePin],
  );
  useWindowViewMenuItem(pinMenuItem);
  useWindowTitleBarAction(pinTitleBarAction);

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
