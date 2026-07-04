import { type MouseEvent, useCallback } from "react";
import { Menu } from "./Menu";
import { NetworkModeMenuItems } from "./NetworkModeMenuItems";
import { useContextMenuState } from "./useContextMenuState";

const NETWORK_CONTEXT_MENU_ID = "network";

export function useNetworkModeContextMenu() {
  const { closeContextMenu, contextMenu, openContextMenu } =
    useContextMenuState<typeof NETWORK_CONTEXT_MENU_ID>();

  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      openContextMenu(event, NETWORK_CONTEXT_MENU_ID);
    },
    [openContextMenu],
  );

  return {
    contextMenu:
      contextMenu === null ? null : (
        <Menu
          direction="down"
          position={contextMenu.position}
          onClose={closeContextMenu}
        >
          <NetworkModeMenuItems onClose={closeContextMenu} />
        </Menu>
      ),
    handleContextMenu,
  };
}
