import { type MouseEvent, useCallback } from "react";
import { Menu } from "./Menu";
import { NetworkModeMenuItems } from "./NetworkModeMenuItems";
import { useContextMenuState } from "./useContextMenuState";

const NETWORK_CONTEXT_MENU_ID = "network";
const BROWSER_CONTEXT_MENU_TARGET_SELECTOR =
  "input, select, textarea, [contenteditable='true']";

function hasSelectedText(): boolean {
  return (window.getSelection()?.toString().trim() ?? "") !== "";
}

function shouldUseBrowserContextMenu(event: MouseEvent<HTMLElement>): boolean {
  return (
    hasSelectedText() ||
    (event.target instanceof Element &&
      event.target.closest(BROWSER_CONTEXT_MENU_TARGET_SELECTOR) !== null)
  );
}

export function useNetworkModeContextMenu() {
  const { closeContextMenu, contextMenu, openContextMenu } =
    useContextMenuState<typeof NETWORK_CONTEXT_MENU_ID>();

  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (shouldUseBrowserContextMenu(event)) {
        event.stopPropagation();
        return;
      }

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
