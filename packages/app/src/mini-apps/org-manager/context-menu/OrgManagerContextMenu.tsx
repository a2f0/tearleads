import { type MouseEvent, useCallback } from "react";
import { Menu } from "../../../components/shared/Menu";
import { MenuItem } from "../../../components/shared/MenuItem";
import {
  type ContextMenuState,
  useContextMenuState,
} from "../../../components/shared/useContextMenuState";
import { ORG_MANAGER_LABELS } from "../labels";
import type { OrgManagerView } from "../routes";

export type OrgManagerContextMenuTarget = Extract<
  OrgManagerView,
  "directory" | "groups"
>;

export type OrgManagerContextMenuState =
  ContextMenuState<OrgManagerContextMenuTarget>;

export interface OrgManagerContextMenuModel {
  closeContextMenu: () => void;
  contextMenu: OrgManagerContextMenuState | null;
  handleSidebarContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    view: OrgManagerContextMenuTarget,
  ) => void;
}

export function useOrgManagerContextMenu(): OrgManagerContextMenuModel {
  const { closeContextMenu, contextMenu, openContextMenu } =
    useContextMenuState<OrgManagerContextMenuTarget>();

  const handleSidebarContextMenu = useCallback(
    (event: MouseEvent<HTMLButtonElement>, view: OrgManagerContextMenuTarget) =>
      openContextMenu(event, view),
    [openContextMenu],
  );

  return {
    closeContextMenu,
    contextMenu,
    handleSidebarContextMenu,
  };
}

export function OrgManagerContextMenuLayer(params: {
  canCreateGroup: boolean;
  canImportRosterUser: boolean;
  closeContextMenu: () => void;
  contextMenu: OrgManagerContextMenuState | null;
  loading: boolean;
  mutating: boolean;
  openCreateGroupDialog: () => void;
  openImportUserDialog: () => void;
}) {
  const {
    canCreateGroup,
    canImportRosterUser,
    closeContextMenu,
    contextMenu,
    loading,
    mutating,
    openCreateGroupDialog,
    openImportUserDialog,
  } = params;

  if (!contextMenu) {
    return null;
  }

  return (
    <Menu
      position={contextMenu.position}
      onClose={closeContextMenu}
      direction="down"
    >
      {contextMenu.id === "directory" ? (
        <MenuItem
          label={ORG_MANAGER_LABELS.importUserAction}
          disabled={!canImportRosterUser || loading || mutating}
          onClick={() => {
            closeContextMenu();
            openImportUserDialog();
          }}
        />
      ) : (
        <MenuItem
          label={ORG_MANAGER_LABELS.newGroupAction}
          disabled={!canCreateGroup || loading || mutating}
          onClick={() => {
            closeContextMenu();
            openCreateGroupDialog();
          }}
        />
      )}
    </Menu>
  );
}
