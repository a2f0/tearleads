import { useCallback } from "react";
import { LocalKeyringUnlockWindow } from "../../mini-apps/LocalKeyringUnlockGate";
import { useWindowActions } from "../window/WindowStateProvider";
import { Menu, type MenuPosition } from "./Menu";
import { PaneSystemMenuItems } from "./PaneSystemMenuItems";

export function PaneMenu({
  position,
  onClose,
  onRequestDestroyKeyPackage,
  onRequestLogout,
  showDeveloperControls,
}: {
  position: MenuPosition;
  onClose: () => void;
  onRequestDestroyKeyPackage: () => void;
  onRequestLogout: () => void;
  showDeveloperControls: boolean;
}) {
  const { create } = useWindowActions();
  const { x, y } = position;
  const openUnlockWindow = useCallback(() => {
    create("Unlock Database", x, y, LocalKeyringUnlockWindow, {
      initialShowSidebar: false,
    });
  }, [create, x, y]);

  return (
    <Menu position={position} onClose={onClose}>
      <PaneSystemMenuItems
        onClose={onClose}
        onOpenUnlock={openUnlockWindow}
        onRequestDestroyKeyPackage={onRequestDestroyKeyPackage}
        onRequestLogout={onRequestLogout}
        showDeveloperControls={showDeveloperControls}
      />
    </Menu>
  );
}
