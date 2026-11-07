import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import {
  type ContextMenuState,
  Menu,
  MenuItem,
  type MenuPosition,
  useContextMenuState,
} from "@tearleads/windowing";
import type { MouseEvent, ReactNode } from "react";

const GRANT_ROW_MENU_OPEN_LABEL = "Open";

interface GrantRowMenuActions<Grant> {
  /** `position` is where the menu opened, for callers that place a window. */
  onOpen: (grant: Grant, position: MenuPosition) => void;
  /**
   * Omit on surfaces that cannot revoke; the menu then offers Open alone.
   * `canRevoke` false keeps the item visible but disabled. `label` comes from
   * the surface that owns revoking, so the menu item reads the same as that
   * surface's other Revoke controls.
   */
  revoke?:
    | {
        canRevoke: (grant: Grant) => boolean;
        label: string;
        onRevoke: (grant: Grant) => void;
      }
    | undefined;
}

function GrantRowMenu<Grant>({
  actions,
  closeMenu,
  menu,
}: {
  actions: GrantRowMenuActions<Grant>;
  closeMenu: () => void;
  menu: ContextMenuState<Grant>;
}) {
  const { id: grant, position } = menu;
  const { revoke } = actions;

  return (
    <Menu direction="down" onClose={closeMenu} position={position}>
      <MenuItem
        icon={EyeIcon}
        label={GRANT_ROW_MENU_OPEN_LABEL}
        onClick={() => {
          closeMenu();
          actions.onOpen(grant, position);
        }}
      />
      {revoke ? (
        <MenuItem
          disabled={!revoke.canRevoke(grant)}
          icon={TrashIcon}
          label={revoke.label}
          onClick={() => {
            closeMenu();
            revoke.onRevoke(grant);
          }}
        />
      ) : null}
    </Menu>
  );
}

/**
 * The grant row overflow menu (Open, plus Revoke where the surface can revoke)
 * shared by Org Manager's grant tables and Explorer's Get Info sharing list, so
 * a row kebab and a right-click / long-press open the same actions. Returns the
 * handler to wire into each row plus the menu node to render once beside the
 * list.
 */
export function useGrantRowMenu<Grant>(actions: GrantRowMenuActions<Grant>): {
  grantRowMenu: ReactNode;
  openGrantRowMenu: (event: MouseEvent<HTMLElement>, grant: Grant) => void;
} {
  const { closeContextMenu, contextMenu, openContextMenu } =
    useContextMenuState<Grant>();

  return {
    grantRowMenu: contextMenu ? (
      <GrantRowMenu
        actions={actions}
        closeMenu={closeContextMenu}
        menu={contextMenu}
      />
    ) : null,
    openGrantRowMenu: openContextMenu,
  };
}
