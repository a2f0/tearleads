import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { UserFocusIcon } from "@phosphor-icons/react/dist/csr/UserFocus";
import { UserPlusIcon } from "@phosphor-icons/react/dist/csr/UserPlus";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import { type MouseEvent, useCallback } from "react";
import { Menu } from "../../../components/shared/Menu";
import { MenuItem } from "../../../components/shared/MenuItem";
import {
  type ContextMenuState,
  useContextMenuState,
} from "../../../components/shared/useContextMenuState";
import { ORG_MANAGER_LABELS } from "../labels";
import type { OrgManagerView } from "../routes";

export type OrgManagerSidebarContextMenuTarget = Extract<
  OrgManagerView,
  "directory" | "groups"
>;

export type OrgManagerContextMenuTarget =
  | OrgManagerSidebarContextMenuTarget
  | { kind: "directory-user"; userId: string };

export type OrgManagerContextMenuState =
  ContextMenuState<OrgManagerContextMenuTarget>;

export function useOrgManagerContextMenu() {
  const { closeContextMenu, contextMenu, openContextMenu } =
    useContextMenuState<OrgManagerContextMenuTarget>();

  const handleSidebarContextMenu = useCallback(
    (
      event: MouseEvent<HTMLElement>,
      view: OrgManagerSidebarContextMenuTarget,
    ) => openContextMenu(event, view),
    [openContextMenu],
  );
  const handleRosterUserContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>, userId: string) =>
      openContextMenu(event, { kind: "directory-user", userId }),
    [openContextMenu],
  );

  return {
    closeContextMenu,
    contextMenu,
    handleRosterUserContextMenu,
    handleSidebarContextMenu,
  };
}

export function OrgManagerContextMenuLayer(params: {
  canCreateGroup: boolean;
  canEditContextMenuRosterUser: boolean;
  canImportRosterUser: boolean;
  closeContextMenu: () => void;
  contextMenu: OrgManagerContextMenuState | null;
  importRosterUserIntoContacts: (userId: string) => void;
  loading: boolean;
  mutating: boolean;
  openCreateGroupDialog: () => void;
  openImportUserDialog: () => void;
  openRosterUser: (userId: string) => void;
  openRosterUserForEditing: (userId: string) => void;
}) {
  const {
    canCreateGroup,
    canEditContextMenuRosterUser,
    canImportRosterUser,
    closeContextMenu,
    contextMenu,
    importRosterUserIntoContacts,
    loading,
    mutating,
    openCreateGroupDialog,
    openImportUserDialog,
    openRosterUser,
    openRosterUserForEditing,
  } = params;

  if (!contextMenu) {
    return null;
  }

  if (
    typeof contextMenu.id === "object" &&
    contextMenu.id.kind === "directory-user"
  ) {
    const userId = contextMenu.id.userId;

    return (
      <Menu
        position={contextMenu.position}
        onClose={closeContextMenu}
        direction="down"
      >
        <MenuItem
          icon={UserFocusIcon}
          label={ORG_MANAGER_LABELS.openRosterEntryAction}
          disabled={loading || mutating}
          onClick={() => {
            closeContextMenu();
            openRosterUser(userId);
          }}
        />
        <MenuItem
          icon={PencilSimpleIcon}
          label={ORG_MANAGER_LABELS.editRosterEntryAction}
          disabled={!canEditContextMenuRosterUser || loading || mutating}
          onClick={() => {
            closeContextMenu();
            openRosterUserForEditing(userId);
          }}
        />
        <MenuItem
          icon={AddressBookIcon}
          label={ORG_MANAGER_LABELS.importRosterEntryIntoContactsAction}
          disabled={loading || mutating}
          onClick={() => {
            closeContextMenu();
            importRosterUserIntoContacts(userId);
          }}
        />
      </Menu>
    );
  }

  return (
    <Menu
      position={contextMenu.position}
      onClose={closeContextMenu}
      direction="down"
    >
      {contextMenu.id === "directory" ? (
        <MenuItem
          icon={UserPlusIcon}
          label={ORG_MANAGER_LABELS.importUserAction}
          disabled={!canImportRosterUser || loading || mutating}
          onClick={() => {
            closeContextMenu();
            openImportUserDialog();
          }}
        />
      ) : (
        <MenuItem
          icon={UsersThreeIcon}
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
