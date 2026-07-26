import { type MouseEvent, useCallback, useState } from "react";
import type { MenuPosition } from "./Menu";

export interface ContextMenuState<TId = string> {
  id: TId;
  position: MenuPosition;
}

interface ContextMenuStateModel<TId = string> {
  closeContextMenu: () => void;
  contextMenu: ContextMenuState<TId> | null;
  openContextMenu: (event: MouseEvent<HTMLElement>, id: TId) => void;
}

/**
 * Where to open the menu: the pointer, or — when the event carries no pointer
 * position — the trigger's own box.
 *
 * Keyboard activation (Enter/Space on a kebab, the context-menu key on a row)
 * dispatches with 0,0 client coordinates, which would pin the menu to the
 * viewport's top-left corner, far from the control that opened it. Anchoring
 * under the trigger instead matches what the standalone kebab menus already do
 * (see MiniAppRowActionsButton's callers). A real click at exactly 0,0 lands in
 * the very corner of the window, where none of these triggers can sit.
 */
function getContextMenuPosition(event: MouseEvent<HTMLElement>): MenuPosition {
  if (event.clientX !== 0 || event.clientY !== 0) {
    return { x: event.clientX, y: event.clientY };
  }

  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom };
}

export function useContextMenuState<TId = string>(params?: {
  onOpen?: (id: TId) => void;
}): ContextMenuStateModel<TId> {
  const [contextMenu, setContextMenu] = useState<ContextMenuState<TId> | null>(
    null,
  );
  const onOpen = params?.onOpen;

  const openContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>, id: TId) => {
      event.preventDefault();
      event.stopPropagation();
      onOpen?.(id);
      setContextMenu({
        id,
        position: getContextMenuPosition(event),
      });
    },
    [onOpen],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  return {
    closeContextMenu,
    contextMenu,
    openContextMenu,
  };
}
