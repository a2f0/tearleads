import { PushPinIcon } from "@phosphor-icons/react/dist/csr/PushPin";
import { useCallback, useId, useState } from "react";
import { PaneStatus } from "../../components/pane/PaneStatus";
import {
  MiniAppButton,
  MiniAppRoot,
  MiniAppToolbar,
} from "../../components/shared/MiniAppLayout";
import { useCurrentWindow } from "../../components/window/CurrentWindowContext";
import { useWindowFileMenuItem } from "../../components/window/WindowMenuContext";
import "./SystemMonitor.css";
import { SystemMonitorLog } from "./SystemMonitorLog";
import { useSystemMonitor } from "./SystemMonitorProvider";

type SystemMonitorTabId = "logs" | "status";

const SYSTEM_MONITOR_TABS: ReadonlyArray<{
  id: SystemMonitorTabId;
  label: string;
}> = [
  { id: "logs", label: "Logs" },
  { id: "status", label: "Status" },
];

const PIN_TO_DESKTOP_LABEL = "Pin to Desktop";

export function SystemMonitorApp() {
  const [activeTab, setActiveTab] = useState<SystemMonitorTabId>("logs");
  const idPrefix = useId();
  const { canPin, pinToDesktop } = useSystemMonitor();
  const currentWindow = useCurrentWindow();

  const handlePin = useCallback(() => {
    pinToDesktop();
    currentWindow?.close();
  }, [pinToDesktop, currentWindow]);

  // Surface the same action in the window's File menu, but only where pinning
  // is meaningful (the windowed home pane that mounts SystemMonitorProvider).
  useWindowFileMenuItem(
    canPin
      ? {
          id: "system-monitor-pin",
          label: PIN_TO_DESKTOP_LABEL,
          onClick: handlePin,
        }
      : null,
  );

  return (
    <MiniAppRoot className="system-monitor">
      {canPin ? (
        <MiniAppToolbar className="system-monitor-toolbar">
          <MiniAppButton onClick={handlePin}>
            <PushPinIcon aria-hidden size={16} /> {PIN_TO_DESKTOP_LABEL}
          </MiniAppButton>
        </MiniAppToolbar>
      ) : null}
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
            variant="ghost"
            onClick={() => {
              setActiveTab(tab.id);
            }}
          >
            {tab.label}
          </MiniAppButton>
        ))}
      </div>
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
