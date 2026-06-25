import { PulseIcon } from "@phosphor-icons/react/dist/csr/Pulse";
import { useCallback } from "react";
import { useMiniAppBusActions } from "../bus";
import "./SystemMonitor.css";
import { useSystemMonitor } from "./SystemMonitorProvider";

const SYSTEM_MONITOR_LABEL = "System Monitor";

// The persistent system-tray affordance in the pane footer. Clicking it brings
// up the monitor window; if the monitor is currently pinned inline it first
// pops back out to a window so there is only ever one visible instance.
export function SystemMonitorLauncherButton() {
  const { openMiniApp } = useMiniAppBusActions();
  const { isPinned, unpinToWindow } = useSystemMonitor();

  const handleClick = useCallback(() => {
    if (isPinned) {
      unpinToWindow();
    }
    openMiniApp({ appId: "system-monitor" });
  }, [isPinned, openMiniApp, unpinToWindow]);

  return (
    <button
      aria-label={SYSTEM_MONITOR_LABEL}
      className="system-monitor-launcher"
      title={SYSTEM_MONITOR_LABEL}
      type="button"
      onClick={handleClick}
    >
      <PulseIcon aria-hidden focusable={false} size={20} />
    </button>
  );
}
