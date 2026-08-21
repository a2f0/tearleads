import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import type { OrganizationGroupSummary } from "@symcrypt/client-sdk";
import { Menu, type MenuPosition } from "../../../components/shared/Menu";
import { MenuItem } from "../../../components/shared/MenuItem";
import { ORG_MANAGER_LABELS } from "../labels";

export function GroupContextMenu({
  canDeleteGroup,
  canCreateGroup,
  closeContextMenu,
  deleteGroup,
  group,
  mutating,
  openCreateGroupDialog,
  position,
}: {
  canDeleteGroup: (group: OrganizationGroupSummary) => boolean;
  canCreateGroup: boolean;
  closeContextMenu: () => void;
  deleteGroup: (groupId: string) => void;
  group: OrganizationGroupSummary | null;
  mutating: boolean;
  openCreateGroupDialog: () => void;
  position: MenuPosition | null;
}) {
  if (!position) {
    return null;
  }

  const handleCreateGroup = () => {
    closeContextMenu();
    openCreateGroupDialog();
  };
  const handleDeleteGroup = () => {
    if (!group) {
      return;
    }

    closeContextMenu();
    deleteGroup(group.groupId);
  };

  return (
    <Menu direction="down" onClose={closeContextMenu} position={position}>
      <MenuItem
        disabled={!canCreateGroup || mutating}
        icon={UsersThreeIcon}
        label={ORG_MANAGER_LABELS.newGroupAction}
        onClick={handleCreateGroup}
      />
      {group ? (
        <MenuItem
          disabled={!canDeleteGroup(group) || mutating}
          icon={TrashIcon}
          label={ORG_MANAGER_LABELS.deleteGroupAction}
          onClick={handleDeleteGroup}
        />
      ) : null}
    </Menu>
  );
}
