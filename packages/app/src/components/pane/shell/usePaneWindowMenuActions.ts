import { useCallback } from "react";

import { LocalKeyringUnlockWindow } from "../../../mini-apps/LocalKeyringUnlockGate";
import { launchSystemMonitorWindow } from "../../../mini-apps/system-monitor/launchSystemMonitorWindow";
import { useSystemMonitor } from "../../../mini-apps/system-monitor/SystemMonitorProvider";
import type { MiniAppId } from "../../../mini-apps/types";
import { useAppNavigationActions } from "../../../navigation/AppNavigationProvider";
import type { MenuPosition } from "../../shared/Menu";
import { useWindowActions } from "../../window/WindowStateProvider";

interface PaneWindowMenuActionOptions {
  position: MenuPosition;
  onClose: () => void;
}

export function usePaneWindowMenuActions({
  position,
  onClose,
}: PaneWindowMenuActionOptions) {
  const { create } = useWindowActions();
  const { openMiniApp: openMiniAppRoute } = useAppNavigationActions();
  const { isPinned, unpinToWindow } = useSystemMonitor();

  const openUnlockWindow = useCallback(() => {
    create(
      "Unlock Database",
      position.x,
      position.y,
      LocalKeyringUnlockWindow,
      { initialShowSidebar: false },
    );
    onClose();
  }, [create, onClose, position]);

  const openMiniApp = useCallback(
    (appId: MiniAppId) => {
      const openWindow = () =>
        openMiniAppRoute({ appId, position, reuseExisting: false });
      if (appId === "system-monitor") {
        launchSystemMonitorWindow({
          isPinned,
          openWindow,
          unpinToWindow,
        });
      } else {
        openWindow();
      }
      onClose();
    },
    [isPinned, onClose, openMiniAppRoute, position, unpinToWindow],
  );

  return { openMiniApp, openUnlockWindow };
}
