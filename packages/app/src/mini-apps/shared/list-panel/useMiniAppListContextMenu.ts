import { type MouseEvent, useCallback } from "react";
import {
  type ContextMenuState,
  useContextMenuState,
} from "../../../components/shared/useContextMenuState";

interface MiniAppListContextMenuModel<Target> {
  closeContextMenu: () => void;
  contextMenu: ContextMenuState<Target> | null;
  handleAreaContextMenu: (event: MouseEvent<HTMLElement>) => void;
  handleRowContextMenu: (event: MouseEvent<HTMLElement>, rowId: string) => void;
}

/**
 * Area + per-row context-menu handlers over the shared context-menu state.
 *
 * Both target inputs must be referentially stable (module-level constant and
 * function): the handlers feed the registered sidebar's memo, and an unstable
 * handler would re-register the sidebar on every render.
 */
export function useMiniAppListContextMenu<Target>(params: {
  areaTarget: Target;
  rowTarget: (rowId: string) => Target;
}): MiniAppListContextMenuModel<Target> {
  const { areaTarget, rowTarget } = params;
  const { closeContextMenu, contextMenu, openContextMenu } =
    useContextMenuState<Target>();

  const handleAreaContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      openContextMenu(event, areaTarget);
    },
    [areaTarget, openContextMenu],
  );
  const handleRowContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>, rowId: string) => {
      openContextMenu(event, rowTarget(rowId));
    },
    [openContextMenu, rowTarget],
  );

  return {
    closeContextMenu,
    contextMenu,
    handleAreaContextMenu,
    handleRowContextMenu,
  };
}
