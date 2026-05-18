import { type MouseEvent, useCallback, useState } from "react";
import type { MenuPosition } from "./Menu";

export interface ContextMenuState<TId extends string = string> {
  id: TId;
  position: MenuPosition;
}

interface ContextMenuStateModel<TId extends string = string> {
  closeContextMenu: () => void;
  contextMenu: ContextMenuState<TId> | null;
  openContextMenu: (event: MouseEvent<HTMLElement>, id: TId) => void;
}

export function useContextMenuState<TId extends string = string>(params?: {
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
        position: { x: event.clientX, y: event.clientY },
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
