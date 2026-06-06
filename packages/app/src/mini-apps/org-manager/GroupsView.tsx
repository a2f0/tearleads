import type {
  OrganizationDirectory,
  OrganizationDirectoryUser,
  OrganizationGroupContainer,
  OrganizationGroupContainers,
  OrganizationGroupMember,
  OrganizationGroupMembers,
  OrganizationGroupPolicyHistory,
  OrganizationGroupSummary,
} from "@tearleads/client-sdk";
import {
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  useId,
} from "react";
import { Menu, type MenuPosition } from "../../components/shared/Menu";
import { MenuItem } from "../../components/shared/MenuItem";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppField,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppInput,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalPanel,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../components/shared/MiniAppLayout";
import {
  MiniAppRow,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../components/shared/MiniAppRow";
import {
  MiniAppTable,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
} from "../../components/shared/MiniAppTable";
import {
  getMiniAppVirtualFrameStyle,
  MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT,
  MINI_APP_VIRTUAL_TABLE_ROW_HEIGHT,
  MiniAppVirtualList,
  MiniAppVirtualListFrame,
  MiniAppVirtualListRow,
  MiniAppVirtualTableSpacerRow,
  useMiniAppVirtualRows,
} from "../../components/shared/MiniAppVirtual";
import { useContextMenuState } from "../../components/shared/useContextMenuState";
import { formatMiniAppDate } from "../../utils/formatMiniAppDate";
import {
  compactFingerprint,
  getAccessLabel,
  getContainerDisplayLabel,
  getContainerDisplayTitle,
  isKeyboardActivationKey,
} from "./display";
import {
  getOrgManagerEpochLabel,
  getOrgManagerMemberCountLabel,
  getOrgManagerPolicyRoleLabel,
  ORG_MANAGER_LABELS,
} from "./labels";
import { PolicyHistorySection } from "./PolicyHistory";

const GROUP_CONTAINER_TABLE_COLUMNS = [
  {
    id: "container",
    header: ORG_MANAGER_LABELS.container,
    width: "42%",
  },
  {
    id: "access",
    header: ORG_MANAGER_LABELS.access,
    width: "7rem",
  },
  {
    className: "org-manager-container-updated-column",
    id: "updated",
    header: ORG_MANAGER_LABELS.updated,
    width: "8rem",
  },
] satisfies ReadonlyArray<MiniAppTableColumn>;

const GROUP_TABLE_COLUMNS = [
  {
    id: "group",
    header: ORG_MANAGER_LABELS.group,
    width: "48%",
  },
  {
    id: "members",
    header: ORG_MANAGER_LABELS.members,
    width: "8rem",
  },
  {
    id: "status",
    header: ORG_MANAGER_LABELS.status,
    width: "7rem",
  },
  {
    className: "org-manager-group-created-column",
    id: "created",
    header: ORG_MANAGER_LABELS.created,
    width: "8rem",
  },
] satisfies ReadonlyArray<MiniAppTableColumn>;

function GroupTable({
  groups,
  openGroupContextMenu,
  selectedGroupId,
  setSelectedGroupId,
}: {
  groups: ReadonlyArray<OrganizationGroupSummary>;
  openGroupContextMenu: (
    event: MouseEvent<HTMLElement>,
    groupId: string | null,
  ) => void;
  selectedGroupId: string | null;
  setSelectedGroupId: (groupId: string) => void;
}) {
  const virtualGroups = useMiniAppVirtualRows({
    rowHeight: MINI_APP_VIRTUAL_TABLE_ROW_HEIGHT,
    rows: groups,
  });

  if (groups.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.noGroups}
      </MiniAppStatus>
    );
  }

  return (
    <MiniAppTableFrame
      className="mini-app-table-frame--virtual org-manager-virtual-table"
      onContextMenu={(event) => {
        if (event.defaultPrevented) {
          return;
        }

        openGroupContextMenu(event, null);
      }}
      ref={virtualGroups.frameRef}
      style={getMiniAppVirtualFrameStyle(MINI_APP_VIRTUAL_TABLE_ROW_HEIGHT)}
    >
      <MiniAppTable
        aria-label={ORG_MANAGER_LABELS.groups}
        columns={GROUP_TABLE_COLUMNS}
      >
        <MiniAppVirtualTableSpacerRow
          colSpan={GROUP_TABLE_COLUMNS.length}
          height={virtualGroups.topPadding}
        />
        {virtualGroups.rows.map((group) => {
          const isSelected = selectedGroupId === group.groupId;
          const openGroupDetail = () => setSelectedGroupId(group.groupId);
          const handleGroupRowKeyDown = (
            event: KeyboardEvent<HTMLTableRowElement>,
          ) => {
            if (isKeyboardActivationKey(event.key)) {
              event.preventDefault();
              openGroupDetail();
            }
          };

          return (
            <MiniAppTableRow
              aria-selected={isSelected}
              interactive
              key={group.groupId}
              onClick={openGroupDetail}
              onContextMenu={(event) =>
                openGroupContextMenu(event, group.groupId)
              }
              onKeyDown={handleGroupRowKeyDown}
              selected={isSelected}
              tabIndex={0}
            >
              <MiniAppTableCell>
                <MiniAppTableText title={group.groupId}>
                  {group.name}
                </MiniAppTableText>
              </MiniAppTableCell>
              <MiniAppTableCell>
                <MiniAppTableText>
                  {group.currentState
                    ? getOrgManagerMemberCountLabel(
                        group.currentState.memberCount,
                      )
                    : ORG_MANAGER_LABELS.uninitialized}
                </MiniAppTableText>
              </MiniAppTableCell>
              <MiniAppTableCell>
                {group.isBuiltin ? (
                  <MiniAppTableText>
                    {ORG_MANAGER_LABELS.builtIn}
                  </MiniAppTableText>
                ) : null}
              </MiniAppTableCell>
              <MiniAppTableCell className="org-manager-group-created-column">
                <MiniAppTableText title={group.createdAt}>
                  {formatMiniAppDate(group.createdAt)}
                </MiniAppTableText>
              </MiniAppTableCell>
            </MiniAppTableRow>
          );
        })}
        <MiniAppVirtualTableSpacerRow
          colSpan={GROUP_TABLE_COLUMNS.length}
          height={virtualGroups.bottomPadding}
        />
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}

function GroupContextMenu({
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
        label={ORG_MANAGER_LABELS.newGroupAction}
        onClick={handleCreateGroup}
      />
      {group ? (
        <MenuItem
          disabled={!canDeleteGroup(group) || mutating}
          label={ORG_MANAGER_LABELS.deleteGroupAction}
          onClick={handleDeleteGroup}
        />
      ) : null}
    </Menu>
  );
}

function CreateGroupDialog({
  canCreateGroup,
  closeCreateGroupDialog,
  createGroup,
  error,
  groupNameDraft,
  isOpen,
  mutating,
  setGroupNameDraft,
}: {
  canCreateGroup: boolean;
  closeCreateGroupDialog: () => void;
  createGroup: () => void;
  error: string | null;
  groupNameDraft: string;
  isOpen: boolean;
  mutating: boolean;
  setGroupNameDraft: (groupName: string) => void;
}) {
  const inputId = useId();

  if (!isOpen) {
    return null;
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreateGroup || mutating || groupNameDraft.trim().length === 0) {
      return;
    }

    createGroup();
  };

  return (
    <MiniAppModalBackdrop role="presentation">
      <MiniAppModalPanel
        role="dialog"
        aria-labelledby="org-manager-new-group-title"
        aria-modal="true"
      >
        <MiniAppModalForm onSubmit={handleSubmit}>
          <h2 id="org-manager-new-group-title">
            {ORG_MANAGER_LABELS.newGroupAction}
          </h2>
          {error && (
            <MiniAppStatus className="org-manager-error" tone="error">
              {error}
            </MiniAppStatus>
          )}
          <MiniAppField>
            <label htmlFor={inputId}>{ORG_MANAGER_LABELS.groupName}</label>
            <MiniAppInput
              id={inputId}
              aria-label={ORG_MANAGER_LABELS.groupName}
              autoFocus
              disabled={!canCreateGroup || mutating}
              onChange={(event) => setGroupNameDraft(event.target.value)}
              value={groupNameDraft}
            />
          </MiniAppField>
          <MiniAppActions>
            <MiniAppButton disabled={mutating} onClick={closeCreateGroupDialog}>
              {ORG_MANAGER_LABELS.cancel}
            </MiniAppButton>
            <MiniAppButton
              disabled={
                !canCreateGroup ||
                mutating ||
                groupNameDraft.trim().length === 0
              }
              type="submit"
            >
              {ORG_MANAGER_LABELS.create}
            </MiniAppButton>
          </MiniAppActions>
        </MiniAppModalForm>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}

function GroupMembers({
  canMutateGroup,
  members,
  mutating,
  removeMember,
  userId,
}: {
  canMutateGroup: boolean;
  members: ReadonlyArray<OrganizationGroupMember>;
  mutating: boolean;
  removeMember: (userId: string) => void;
  userId: string | null;
}) {
  const virtualMembers = useMiniAppVirtualRows({
    rowHeight: MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT,
    rows: members,
  });

  if (members.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.noGroupMembers}
      </MiniAppStatus>
    );
  }

  const adminCount = members.filter(
    (member) =>
      member.memberPrincipalType === "user" && member.role === "admin",
  ).length;

  return (
    <MiniAppVirtualListFrame
      className="org-manager-virtual-list"
      ref={virtualMembers.frameRef}
      rowHeight={MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT}
    >
      <MiniAppVirtualList
        bottomPadding={virtualMembers.bottomPadding}
        topPadding={virtualMembers.topPadding}
      >
        {virtualMembers.rows.map((member) => {
          const isLastAdmin = member.role === "admin" && adminCount <= 1;
          const canRemove =
            canMutateGroup &&
            member.memberPrincipalType === "user" &&
            member.memberPrincipalId !== userId &&
            !isLastAdmin;

          return (
            <MiniAppVirtualListRow key={member.memberPrincipalId}>
              <MiniAppRow
                className="org-manager-member-row"
                density="roomy"
                variant="framed"
              >
                <MiniAppRowStack>
                  <strong title={member.memberPrincipalId}>
                    {member.userId
                      ? compactFingerprint(member.userId)
                      : (member.groupName ??
                        compactFingerprint(member.memberPrincipalId))}
                  </strong>
                  <MiniAppRowText muted>
                    {getOrgManagerPolicyRoleLabel(member.role)}
                  </MiniAppRowText>
                </MiniAppRowStack>
                {member.memberPrincipalType === "user" && (
                  <MiniAppButton
                    disabled={!canRemove || mutating}
                    onClick={() => removeMember(member.memberPrincipalId)}
                  >
                    {ORG_MANAGER_LABELS.remove}
                  </MiniAppButton>
                )}
              </MiniAppRow>
            </MiniAppVirtualListRow>
          );
        })}
      </MiniAppVirtualList>
    </MiniAppVirtualListFrame>
  );
}

function GroupContainers({
  containers,
}: {
  containers: ReadonlyArray<OrganizationGroupContainer>;
}) {
  const virtualContainers = useMiniAppVirtualRows({
    rowHeight: MINI_APP_VIRTUAL_TABLE_ROW_HEIGHT,
    rows: containers,
  });

  if (containers.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.noDirectContainerLinks}
      </MiniAppStatus>
    );
  }

  return (
    <MiniAppTableFrame
      className="mini-app-table-frame--virtual org-manager-virtual-table"
      ref={virtualContainers.frameRef}
      style={getMiniAppVirtualFrameStyle(MINI_APP_VIRTUAL_TABLE_ROW_HEIGHT)}
    >
      <MiniAppTable
        aria-label={ORG_MANAGER_LABELS.directContainerLinks}
        columns={GROUP_CONTAINER_TABLE_COLUMNS}
      >
        <MiniAppVirtualTableSpacerRow
          colSpan={GROUP_CONTAINER_TABLE_COLUMNS.length}
          height={virtualContainers.topPadding}
        />
        {virtualContainers.rows.map((container) => (
          <MiniAppTableRow key={container.containerId}>
            <MiniAppTableCell>
              <MiniAppTableText title={getContainerDisplayTitle(container)}>
                {getContainerDisplayLabel(container)}
              </MiniAppTableText>
            </MiniAppTableCell>
            <MiniAppTableCell>
              <MiniAppTableText>
                {getAccessLabel(container.accessLevel)}
              </MiniAppTableText>
            </MiniAppTableCell>
            <MiniAppTableCell className="org-manager-container-updated-column">
              <MiniAppTableText title={container.updatedAt}>
                {formatMiniAppDate(container.updatedAt)}
              </MiniAppTableText>
            </MiniAppTableCell>
          </MiniAppTableRow>
        ))}
        <MiniAppVirtualTableSpacerRow
          colSpan={GROUP_CONTAINER_TABLE_COLUMNS.length}
          height={virtualContainers.bottomPadding}
        />
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}

function GroupListSection({
  groups,
  openGroupContextMenu,
  selectedGroupId,
  selectGroup,
}: {
  groups: ReadonlyArray<OrganizationGroupSummary>;
  openGroupContextMenu: (
    event: MouseEvent<HTMLElement>,
    groupId: string | null,
  ) => void;
  selectedGroupId: string | null;
  selectGroup: (groupId: string | null) => void;
}) {
  return (
    <section
      aria-label={ORG_MANAGER_LABELS.groups}
      className="org-manager-panel org-manager-panel--context-target"
      onContextMenu={(event) => {
        if (event.defaultPrevented) {
          return;
        }

        openGroupContextMenu(event, null);
      }}
    >
      <GroupTable
        groups={groups}
        openGroupContextMenu={openGroupContextMenu}
        selectedGroupId={selectedGroupId}
        setSelectedGroupId={selectGroup}
      />
    </section>
  );
}

function GroupDetailHeader({
  openGroupContextMenu,
  selectedGroup,
  selectGroup,
}: {
  openGroupContextMenu: (
    event: MouseEvent<HTMLElement>,
    groupId: string | null,
  ) => void;
  selectedGroup: OrganizationGroupSummary;
  selectGroup: (groupId: string | null) => void;
}) {
  return (
    <MiniAppHeader
      className="org-manager-detail-header"
      onContextMenu={(event) =>
        openGroupContextMenu(event, selectedGroup.groupId)
      }
    >
      <MiniAppHeaderCopy>
        <strong>{selectedGroup.name}</strong>
        <span title={selectedGroup.groupId}>
          {compactFingerprint(selectedGroup.groupId)}
        </span>
      </MiniAppHeaderCopy>
      <span>
        {selectedGroup.currentState
          ? getOrgManagerEpochLabel(selectedGroup.currentState.keyEpoch)
          : ORG_MANAGER_LABELS.noPolicy}
      </span>
      <MiniAppButton onClick={() => selectGroup(null)} variant="ghost">
        {ORG_MANAGER_LABELS.back}
      </MiniAppButton>
    </MiniAppHeader>
  );
}

function GroupDetailSection({
  addUser,
  addUserId,
  addUserListId,
  addableUsers,
  canMutateSelectedGroup,
  directory,
  groupContainers,
  groupPolicyHistory,
  groups,
  members,
  memberUserIds,
  mutating,
  openGroupContextMenu,
  removeMember,
  selectedGroup,
  selectGroup,
  setAddUserId,
  userId,
}: {
  addUser: () => void;
  addUserId: string;
  addUserListId: string;
  addableUsers: ReadonlyArray<OrganizationDirectoryUser>;
  canMutateSelectedGroup: boolean;
  directory: OrganizationDirectory | null;
  groupContainers: OrganizationGroupContainers | null;
  groupPolicyHistory: OrganizationGroupPolicyHistory | null;
  groups: ReadonlyArray<OrganizationGroupSummary>;
  members: OrganizationGroupMembers | null;
  memberUserIds: ReadonlySet<string>;
  mutating: boolean;
  openGroupContextMenu: (
    event: MouseEvent<HTMLElement>,
    groupId: string | null,
  ) => void;
  removeMember: (userId: string) => void;
  selectedGroup: OrganizationGroupSummary;
  selectGroup: (groupId: string | null) => void;
  setAddUserId: (userId: string) => void;
  userId: string | null;
}) {
  return (
    <section className="org-manager-panel">
      <GroupDetailHeader
        openGroupContextMenu={openGroupContextMenu}
        selectedGroup={selectedGroup}
        selectGroup={selectGroup}
      />
      <MiniAppToolbar className="org-manager-form-toolbar">
        <MiniAppInput
          aria-label={ORG_MANAGER_LABELS.userId}
          disabled={!canMutateSelectedGroup || mutating}
          list={addUserListId}
          onChange={(event) => setAddUserId(event.target.value)}
          placeholder={ORG_MANAGER_LABELS.userId}
          value={addUserId}
        />
        <datalist id={addUserListId}>
          {addableUsers.map((user) => (
            <option key={user.userId} value={user.userId}>
              {user.isSelf
                ? ORG_MANAGER_LABELS.self
                : compactFingerprint(user.userId)}
            </option>
          ))}
        </datalist>
        <MiniAppButton
          disabled={
            !canMutateSelectedGroup ||
            mutating ||
            !members ||
            addUserId.trim().length === 0 ||
            memberUserIds.has(addUserId.trim())
          }
          onClick={addUser}
        >
          {ORG_MANAGER_LABELS.add}
        </MiniAppButton>
      </MiniAppToolbar>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.members}
        </MiniAppSectionHeading>
        <GroupMembers
          canMutateGroup={canMutateSelectedGroup}
          members={members?.members ?? []}
          mutating={mutating}
          removeMember={removeMember}
          userId={userId}
        />
      </MiniAppSection>
      <PolicyHistorySection
        directory={directory}
        groups={groups}
        heading={ORG_MANAGER_LABELS.policyHistory}
        history={groupPolicyHistory}
      />
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.directContainerLinks}
        </MiniAppSectionHeading>
        <GroupContainers containers={groupContainers?.containers ?? []} />
      </MiniAppSection>
    </section>
  );
}

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
  error?: string | null | undefined;
  groupContainers: OrganizationGroupContainers | null;
  groupNameDraft: string;
  groupPolicyHistory: OrganizationGroupPolicyHistory | null;
  groups: ReadonlyArray<OrganizationGroupSummary>;
  isCreateGroupDialogOpen: boolean;
  members: OrganizationGroupMembers | null;
  memberUserIds: ReadonlySet<string>;
  mutating: boolean;
  openCreateGroupDialog: () => void;
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
  openCreateGroupDialog,
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
      error={error ?? null}
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
        addUser={addUser}
        addUserId={addUserId}
        addUserListId={addUserListId}
        addableUsers={addableUsers}
        canMutateSelectedGroup={canMutateSelectedGroup}
        directory={directory}
        groupContainers={groupContainers}
        groupPolicyHistory={groupPolicyHistory}
        groups={groups}
        members={members}
        memberUserIds={memberUserIds}
        mutating={mutating}
        openGroupContextMenu={openContextMenu}
        removeMember={removeMember}
        selectedGroup={selectedGroup}
        selectGroup={selectGroup}
        setAddUserId={setAddUserId}
        userId={userId}
      />
      {groupContextMenu}
      {createGroupDialog}
    </>
  );
}
