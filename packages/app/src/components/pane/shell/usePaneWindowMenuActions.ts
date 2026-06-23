import { useCallback } from "react";

import { LocalKeyringUnlockWindow } from "../../../mini-apps/LocalKeyringUnlockGate";
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
      openMiniAppRoute({ appId, position, reuseExisting: false });
      onClose();
    },
    [onClose, openMiniAppRoute, position],
  );

  return { openMiniApp, openUnlockWindow };
}
