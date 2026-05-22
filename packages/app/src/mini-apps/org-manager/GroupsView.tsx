import {
  MiniAppButton,
  MiniAppInput,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../components/shared/MiniAppLayout";
import {
  MiniAppRow,
  MiniAppRowButton,
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
import type {
  OrgManagerDirectory,
  OrgManagerDirectoryUser,
  OrgManagerGroupContainer,
  OrgManagerGroupContainers,
  OrgManagerGroupMember,
  OrgManagerGroupMembers,
  OrgManagerGroupPolicyHistory,
  OrgManagerGroupSummary,
} from "../../stores/org-manager/OrgManagerProvider";
import { formatMiniAppDate } from "../../utils/formatMiniAppDate";
import {
  compactFingerprint,
  getAccessLabel,
  getContainerDisplayLabel,
  getContainerDisplayTitle,
} from "./display";
import {
  getOrgManagerEpochLabel,
  getOrgManagerMemberCountLabel,
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

function GroupList({
  groups,
  selectedGroupId,
  setSelectedGroupId,
}: {
  groups: ReadonlyArray<OrgManagerGroupSummary>;
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
    <div className="org-manager-group-list">
      {groups.map((group) => {
        const isSelected = selectedGroupId === group.groupId;

        return (
          <MiniAppRowButton
            className="org-manager-group-button"
            density="roomy"
            key={group.groupId}
            onClick={() => setSelectedGroupId(group.groupId)}
            selected={isSelected}
          >
            <MiniAppRowStack>
              <strong>{group.name}</strong>
              <MiniAppRowText muted>
                {group.currentState
                  ? getOrgManagerMemberCountLabel(
                      group.currentState.memberCount,
                    )
                  : ORG_MANAGER_LABELS.uninitialized}
              </MiniAppRowText>
            </MiniAppRowStack>
          </MiniAppRowButton>
        );
      })}
    </div>
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
  members: ReadonlyArray<OrgManagerGroupMember>;
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
              <MiniAppRowText muted>{member.role}</MiniAppRowText>
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
  containers: ReadonlyArray<OrgManagerGroupContainer>;
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
  createGroup,
  directory,
  groupContainers,
  groupNameDraft,
  groupPolicyHistory,
  groups,
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
  addableUsers: ReadonlyArray<OrgManagerDirectoryUser>;
  canCreateGroup: boolean;
  canMutateSelectedGroup: boolean;
  createGroup: () => void;
  directory: OrgManagerDirectory | null;
  groupContainers: OrgManagerGroupContainers | null;
  groupNameDraft: string;
  groupPolicyHistory: OrgManagerGroupPolicyHistory | null;
  groups: ReadonlyArray<OrgManagerGroupSummary>;
  members: OrgManagerGroupMembers | null;
  memberUserIds: ReadonlySet<string>;
  mutating: boolean;
  removeMember: (userId: string) => void;
  selectedGroup: OrgManagerGroupSummary | null;
  selectedGroupId: string | null;
  selectGroup: (groupId: string) => void;
  setAddUserId: (userId: string) => void;
  setGroupNameDraft: (groupName: string) => void;
  userId: string | null;
}) {
  return (
    <div className="org-manager-groups">
      <section className="org-manager-panel">
        <MiniAppToolbar className="org-manager-form-toolbar">
          <MiniAppInput
            disabled={!canCreateGroup || mutating}
            onChange={(event) => setGroupNameDraft(event.target.value)}
            placeholder={ORG_MANAGER_LABELS.groupName}
            value={groupNameDraft}
          />
          <MiniAppButton
            disabled={
              !canCreateGroup || mutating || groupNameDraft.trim().length === 0
            }
            onClick={createGroup}
          >
            {ORG_MANAGER_LABELS.create}
          </MiniAppButton>
        </MiniAppToolbar>
        <GroupList
          groups={groups}
          selectedGroupId={selectedGroupId}
          setSelectedGroupId={selectGroup}
        />
      </section>
      <section className="org-manager-panel org-manager-panel--detail">
        {selectedGroup ? (
          <>
            <div className="org-manager-detail-header">
              <div>
                <strong>{selectedGroup.name}</strong>
                <span title={selectedGroup.groupId}>
                  {compactFingerprint(selectedGroup.groupId)}
                </span>
              </div>
              <span>
                {selectedGroup.currentState
                  ? getOrgManagerEpochLabel(selectedGroup.currentState.keyEpoch)
                  : ORG_MANAGER_LABELS.noPolicy}
              </span>
            </div>
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
          </>
        ) : (
          <MiniAppStatus className="org-manager-hint">
            {ORG_MANAGER_LABELS.selectGroup}
          </MiniAppStatus>
        )}
      </section>
    </div>
  );
}
