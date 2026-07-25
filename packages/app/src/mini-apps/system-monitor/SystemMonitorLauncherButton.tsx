import { useCallback } from "react";
import { useNetworkModeContextMenu } from "../../components/shared/NetworkModeContextMenu";
import { useMiniAppBusActions } from "../bus";
import { SystemMonitorIcon } from "./icon";
import { launchSystemMonitorWindow } from "./launchSystemMonitorWindow";
import { useSystemMonitor } from "./SystemMonitorProvider";

const SYSTEM_MONITOR_LABEL = "System Monitor";

// The persistent system-tray affordance in the pane footer. Clicking it brings
// up the monitor window; if the monitor is currently pinned inline it first
// pops back out to a window so there is only ever one visible instance.
export function SystemMonitorLauncherButton() {
  const { openMiniApp } = useMiniAppBusActions();
  const { isPinned, unpinToWindow } = useSystemMonitor();
  const networkContextMenu = useNetworkModeContextMenu();

  const handleClick = useCallback(() => {
    launchSystemMonitorWindow({
      isPinned,
      openWindow: () => openMiniApp({ appId: "system-monitor" }),
      unpinToWindow,
    });
  }, [isPinned, openMiniApp, unpinToWindow]);

  return (
    <>
      <button
        aria-label={SYSTEM_MONITOR_LABEL}
        className="tearleads-action-button tearleads-action-button--icon"
        title={SYSTEM_MONITOR_LABEL}
        type="button"
        onClick={handleClick}
        onContextMenu={networkContextMenu.handleContextMenu}
      >
        <SystemMonitorIcon aria-hidden focusable={false} size={20} />
      </button>
      {networkContextMenu.contextMenu}
    </>
  );
}
