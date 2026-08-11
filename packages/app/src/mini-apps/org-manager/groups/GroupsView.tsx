import type {
  OrganizationDirectory,
  OrganizationDirectoryUser,
  OrganizationGroupContainers,
  OrganizationGroupMembers,
  OrganizationGroupPolicyHistory,
  OrganizationGroupSummary,
} from "@tearleads/client-sdk";
import { useContextMenuState } from "../../../components/shared/useContextMenuState";
import { CreateGroupDialog } from "./CreateGroupDialog";
import { GroupContextMenu } from "./GroupContextMenu";
import { GroupDetailSection } from "./GroupDetailSection";
import { GroupListSection } from "./GroupTable";

interface GroupsViewProps {
  addUser: () => void;
  addUserId: string;
  addUserListId: string;
  addableUsers: ReadonlyArray<OrganizationDirectoryUser>;
  canCreateGroup: boolean;
  canDeleteGroup: (group: OrganizationGroupSummary) => boolean;
  canMutateSelectedGroup: boolean;
  closeCreateGroupDialog: () => void;
  createGroup: () => void;
  deleteGroup: (groupId: string) => void;
  directory: OrganizationDirectory | null;
  error: string | null;
  groupContainers: OrganizationGroupContainers | null;
  groupNameDraft: string;
  groupPolicyHistory: OrganizationGroupPolicyHistory | null;
  groups: ReadonlyArray<OrganizationGroupSummary>;
  isCreateGroupDialogOpen: boolean;
  members: OrganizationGroupMembers | null;
  memberUserIds: ReadonlySet<string>;
  mutating: boolean;
  pending: boolean;
  openCreateGroupDialog: () => void;
  openRosterUser: (userId: string) => void;
  profileDisplayNamesByUserId: ReadonlyMap<string, string>;
  removeMember: (userId: string) => void;
  selectedGroup: OrganizationGroupSummary | null;
  selectedGroupId: string | null;
  selectGroup: (groupId: string | null) => void;
  setAddUserId: (userId: string) => void;
  setGroupNameDraft: (groupName: string) => void;
  userId: string | null;
}

export function GroupsView({
  addUser,
  addUserId,
  addUserListId,
  addableUsers,
  canCreateGroup,
  canDeleteGroup,
  canMutateSelectedGroup,
  closeCreateGroupDialog,
  createGroup,
  deleteGroup,
  directory,
  error,
  groupContainers,
  groupNameDraft,
  groupPolicyHistory,
  groups,
  isCreateGroupDialogOpen,
  members,
  memberUserIds,
  mutating,
  pending,
  openCreateGroupDialog,
  openRosterUser,
  profileDisplayNamesByUserId,
  removeMember,
  selectedGroup,
  selectedGroupId,
  selectGroup,
  setAddUserId,
  setGroupNameDraft,
  userId,
}: GroupsViewProps) {
  const { closeContextMenu, contextMenu, openContextMenu } =
    useContextMenuState<string | null>();
  const contextMenuGroup =
    groups.find((group) => group.groupId === contextMenu?.id) ?? null;
  const groupContextMenu = (
    <GroupContextMenu
      canCreateGroup={canCreateGroup}
      canDeleteGroup={canDeleteGroup}
      closeContextMenu={closeContextMenu}
      deleteGroup={deleteGroup}
      group={contextMenuGroup}
      mutating={mutating}
      openCreateGroupDialog={openCreateGroupDialog}
      position={contextMenu?.position ?? null}
    />
  );
  const createGroupDialog = (
    <CreateGroupDialog
      canCreateGroup={canCreateGroup}
      closeCreateGroupDialog={closeCreateGroupDialog}
      createGroup={createGroup}
      error={error}
      groupNameDraft={groupNameDraft}
      isOpen={isCreateGroupDialogOpen}
      mutating={mutating}
      setGroupNameDraft={setGroupNameDraft}
    />
  );
  const groupListSection = (
    <GroupListSection
      groups={groups}
      openGroupContextMenu={openContextMenu}
      selectedGroupId={selectedGroupId}
      selectGroup={selectGroup}
    />
  );

  if (!selectedGroup) {
    return (
      <>
        {groupListSection}
        {groupContextMenu}
        {createGroupDialog}
      </>
    );
  }

  return (
    <>
      <GroupDetailSection
        pending={pending}
        addUser={addUser}
        addUserId={addUserId}
        addUserListId={addUserListId}
        addableUsers={addableUsers}
        canMutateSelectedGroup={canMutateSelectedGroup}
        directory={directory}
        groupContainers={groupContainers}
        groupPolicyHistory={groupPolicyHistory}
        members={members}
        memberUserIds={memberUserIds}
        mutating={mutating}
        openGroupContextMenu={openContextMenu}
        openRosterUser={openRosterUser}
        profileDisplayNamesByUserId={profileDisplayNamesByUserId}
        removeMember={removeMember}
        selectedGroup={selectedGroup}
        setAddUserId={setAddUserId}
        userId={userId}
      />
      {groupContextMenu}
      {createGroupDialog}
    </>
  );
}
