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
import type { FormEvent, KeyboardEvent } from "react";
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
    className: "org-manager-group-created-column",
    id: "created",
    header: ORG_MANAGER_LABELS.created,
    width: "8rem",
  },
] satisfies ReadonlyArray<MiniAppTableColumn>;

function GroupTable({
  groups,
  selectedGroupId,
  setSelectedGroupId,
}: {
  groups: ReadonlyArray<OrganizationGroupSummary>;
  selectedGroupId: string | null;
  setSelectedGroupId: (groupId: string) => void;
}) {
  if (groups.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.noGroups}
      </MiniAppStatus>
    );
  }

  return (
    <MiniAppTableFrame>
      <MiniAppTable
        aria-label={ORG_MANAGER_LABELS.groups}
        columns={GROUP_TABLE_COLUMNS}
      >
        {groups.map((group) => {
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
              onKeyDown={handleGroupRowKeyDown}
              selected={isSelected}
              tabIndex={0}
            >
              <MiniAppTableCell>
                <MiniAppTableText title={group.groupId}>
                  {group.name}
                </MiniAppTableText>
                <MiniAppTableText muted title={group.groupId}>
                  {compactFingerprint(group.groupId)}
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
              <MiniAppTableCell className="org-manager-group-created-column">
                <MiniAppTableText title={group.createdAt}>
                  {formatMiniAppDate(group.createdAt)}
                </MiniAppTableText>
              </MiniAppTableCell>
            </MiniAppTableRow>
          );
        })}
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}

function CreateGroupDialog({
  canCreateGroup,
  closeCreateGroupDialog,
  createGroup,
  groupNameDraft,
  isOpen,
  mutating,
  setGroupNameDraft,
}: {
  canCreateGroup: boolean;
  closeCreateGroupDialog: () => void;
  createGroup: () => void;
  groupNameDraft: string;
  isOpen: boolean;
  mutating: boolean;
  setGroupNameDraft: (groupName: string) => void;
}) {
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
          <MiniAppField>
            <span>{ORG_MANAGER_LABELS.groupName}</span>
            <MiniAppInput
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
    <div className="org-manager-member-list">
      {members.map((member) => {
        const isLastAdmin = member.role === "admin" && adminCount <= 1;
        const canRemove =
          canMutateGroup &&
          member.memberPrincipalType === "user" &&
          member.memberPrincipalId !== userId &&
          !isLastAdmin;

        return (
          <MiniAppRow
            className="org-manager-member-row"
            density="roomy"
            key={member.memberPrincipalId}
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
        );
      })}
    </div>
  );
}

function GroupContainers({
  containers,
}: {
  containers: ReadonlyArray<OrganizationGroupContainer>;
}) {
  if (containers.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.noDirectContainerLinks}
      </MiniAppStatus>
    );
  }

  return (
    <MiniAppTableFrame>
      <MiniAppTable
        aria-label={ORG_MANAGER_LABELS.directContainerLinks}
        columns={GROUP_CONTAINER_TABLE_COLUMNS}
      >
        {containers.map((container) => (
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
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}

export function GroupsView({
  addUser,
  addUserId,
  addUserListId,
  addableUsers,
  canCreateGroup,
  canMutateSelectedGroup,
  closeCreateGroupDialog,
  createGroup,
  directory,
  groupContainers,
  groupNameDraft,
  groupPolicyHistory,
  groups,
  isCreateGroupDialogOpen,
  members,
  memberUserIds,
  mutating,
  removeMember,
  selectedGroup,
  selectedGroupId,
  selectGroup,
  setAddUserId,
  setGroupNameDraft,
  userId,
}: {
  addUser: () => void;
  addUserId: string;
  addUserListId: string;
  addableUsers: ReadonlyArray<OrganizationDirectoryUser>;
  canCreateGroup: boolean;
  canMutateSelectedGroup: boolean;
  closeCreateGroupDialog: () => void;
  createGroup: () => void;
  directory: OrganizationDirectory | null;
  groupContainers: OrganizationGroupContainers | null;
  groupNameDraft: string;
  groupPolicyHistory: OrganizationGroupPolicyHistory | null;
  groups: ReadonlyArray<OrganizationGroupSummary>;
  isCreateGroupDialogOpen: boolean;
  members: OrganizationGroupMembers | null;
  memberUserIds: ReadonlySet<string>;
  mutating: boolean;
  removeMember: (userId: string) => void;
  selectedGroup: OrganizationGroupSummary | null;
  selectedGroupId: string | null;
  selectGroup: (groupId: string | null) => void;
  setAddUserId: (userId: string) => void;
  setGroupNameDraft: (groupName: string) => void;
  userId: string | null;
}) {
  const createGroupDialog = (
    <CreateGroupDialog
      canCreateGroup={canCreateGroup}
      closeCreateGroupDialog={closeCreateGroupDialog}
      createGroup={createGroup}
      groupNameDraft={groupNameDraft}
      isOpen={isCreateGroupDialogOpen}
      mutating={mutating}
      setGroupNameDraft={setGroupNameDraft}
    />
  );
  const groupListSection = (
    <section className="org-manager-panel">
      <GroupTable
        groups={groups}
        selectedGroupId={selectedGroupId}
        setSelectedGroupId={selectGroup}
      />
    </section>
  );

  if (!selectedGroup) {
    return (
      <>
        {groupListSection}
        {createGroupDialog}
      </>
    );
  }

  return (
    <>
      <section className="org-manager-panel">
        <MiniAppHeader className="org-manager-detail-header">
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
      {createGroupDialog}
    </>
  );
}
