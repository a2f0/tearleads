import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MiniAppButton,
  MiniAppInput,
  MiniAppRoot,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
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
import { useWindowRefreshMenuItem } from "../../components/window/WindowMenuContext";
import { useAppData } from "../../providers/data/AppDataProvider";
import {
  type OrgManagerContainerGrant,
  type OrgManagerContainerGrants,
  type OrgManagerDataUsage,
  type OrgManagerDirectory,
  type OrgManagerDirectoryUser,
  type OrgManagerGroupContainer,
  type OrgManagerGroupContainers,
  type OrgManagerGroupMember,
  type OrgManagerGroupMembers,
  type OrgManagerGroupPolicyHistory,
  type OrgManagerGroupSummary,
  type OrgManagerPolicyHistory,
  type OrgManagerUserDetail,
  type OrgManagerUserRecipient,
  useOrgManagerActions,
} from "../../stores/org-manager/OrgManagerProvider";
import { formatByteLength } from "../../utils/formatByteLength";
import { formatMiniAppDate } from "../../utils/formatMiniAppDate";
import { useMiniAppMessage } from "../bus";
import { useOrgManagerRoute } from "./hooks/useOrgManagerRoute";
import {
  getOrgManagerEpochLabel,
  getOrgManagerMemberCountLabel,
  getOrgManagerPolicyAddedLabel,
  getOrgManagerPolicyChangeTypeLabel,
  getOrgManagerPolicyMemberTypeLabel,
  getOrgManagerPolicyRemovedLabel,
  getOrgManagerPolicyRoleChangedLabel,
  getOrgManagerPolicyRoleLabel,
  getOrgManagerPolicyRoleTransitionLabel,
  getOrgManagerPolicySignatureLabel,
  getOrgManagerPolicyVersionLabel,
  ORG_MANAGER_LABELS,
} from "./labels";
import "./OrgManager.css";
import { useOrgManagerSidebarPanel } from "./OrgManagerSidebar";
import { resolveOrgManagerSelectedGroupId } from "./routes";

const DIRECTORY_TABLE_COLUMNS = [
  {
    id: "user",
    header: ORG_MANAGER_LABELS.user,
    width: "38%",
  },
  {
    id: "signing-key",
    header: ORG_MANAGER_LABELS.signingKey,
    width: "38%",
  },
  {
    className: "org-manager-directory-joined-column",
    id: "joined",
    header: ORG_MANAGER_LABELS.joined,
    width: "8rem",
  },
] satisfies ReadonlyArray<MiniAppTableColumn>;

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

const GRANT_TABLE_COLUMNS = [
  {
    id: "principal",
    header: ORG_MANAGER_LABELS.principal,
    width: "34%",
  },
  {
    id: "container",
    header: ORG_MANAGER_LABELS.container,
    width: "34%",
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
  {
    id: "action",
    header: ORG_MANAGER_LABELS.action,
    width: "6rem",
  },
] satisfies ReadonlyArray<MiniAppTableColumn>;

const ACCESS_LEVEL_LABELS = {
  admin: ORG_MANAGER_LABELS.accessAdmin,
  read: ORG_MANAGER_LABELS.accessRead,
  write: ORG_MANAGER_LABELS.accessWrite,
} satisfies Record<OrgManagerGroupContainer["accessLevel"], string>;

type OrgManagerGroupPolicyHistoryEntry =
  OrgManagerGroupPolicyHistory["entries"][number];
type OrgManagerPrincipalMemberChange =
  OrgManagerGroupPolicyHistoryEntry["changes"][number];

function userRecipient(user: OrgManagerDirectoryUser): OrgManagerUserRecipient {
  return {
    userId: user.userId,
    encapsulationPublicKey: user.encapsulationPublicKey,
    encapsulationKeyFingerprint: user.encapsulationKeyFingerprint,
  };
}

function memberUserRecipient(
  member: OrgManagerGroupMember,
): OrgManagerUserRecipient | null {
  if (
    member.memberPrincipalType !== "user" ||
    !member.encapsulationPublicKey ||
    !member.encapsulationKeyFingerprint
  ) {
    return null;
  }

  return {
    userId: member.memberPrincipalId,
    encapsulationPublicKey: member.encapsulationPublicKey,
    encapsulationKeyFingerprint: member.encapsulationKeyFingerprint,
  };
}

function currentGroupUserRecipients(input: {
  directory: OrgManagerDirectory;
  members: OrgManagerGroupMembers | null;
}): OrgManagerUserRecipient[] {
  const recipientsById = new Map<string, OrgManagerUserRecipient>();

  for (const user of input.directory.users) {
    const recipient = userRecipient(user);
    recipientsById.set(recipient.userId, recipient);
  }

  for (const member of input.members?.members ?? []) {
    const recipient = memberUserRecipient(member);
    if (recipient) {
      recipientsById.set(recipient.userId, recipient);
    }
  }

  return [...recipientsById.values()];
}

function compactFingerprint(value: string): string {
  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function getAccessLabel(
  accessLevel: OrgManagerGroupContainer["accessLevel"],
): string {
  return ACCESS_LEVEL_LABELS[accessLevel];
}

function getGrantPrincipalLabel(grant: OrgManagerContainerGrant): string {
  if (grant.subjectType === "group") {
    return grant.groupName ?? compactFingerprint(grant.subjectId);
  }
  if (grant.subjectType === "organization") {
    return grant.organizationName ?? compactFingerprint(grant.subjectId);
  }

  return grant.userId
    ? compactFingerprint(grant.userId)
    : compactFingerprint(grant.subjectId);
}

function getPolicyMemberLabel(input: {
  change: OrgManagerPrincipalMemberChange;
  directory: OrgManagerDirectory | null;
  groups: ReadonlyArray<OrgManagerGroupSummary>;
}): string {
  if (input.change.memberPrincipalType === "group") {
    return (
      input.groups.find(
        (group) => group.groupId === input.change.memberPrincipalId,
      )?.name ?? compactFingerprint(input.change.memberPrincipalId)
    );
  }

  const user = input.directory?.users.find(
    (directoryUser) => directoryUser.userId === input.change.memberPrincipalId,
  );
  if (user?.isSelf) {
    return ORG_MANAGER_LABELS.self;
  }

  return compactFingerprint(input.change.memberPrincipalId);
}

function getPolicyChangeLabel(input: {
  change: OrgManagerPrincipalMemberChange;
  directory: OrgManagerDirectory | null;
  groups: ReadonlyArray<OrgManagerGroupSummary>;
}): string {
  const memberLabel = getPolicyMemberLabel(input);

  switch (input.change.changeType) {
    case "added":
      return getOrgManagerPolicyAddedLabel(memberLabel, input.change.nextRole);
    case "removed":
      return getOrgManagerPolicyRemovedLabel(memberLabel);
    case "role_changed":
      return getOrgManagerPolicyRoleChangedLabel(
        memberLabel,
        getOrgManagerPolicyRoleLabel(input.change.previousRole),
        getOrgManagerPolicyRoleLabel(input.change.nextRole),
      );
  }
}

function getPolicyChangeRoleDetail(
  change: OrgManagerPrincipalMemberChange,
): string | null {
  switch (change.changeType) {
    case "added":
      return change.nextRole
        ? getOrgManagerPolicyRoleLabel(change.nextRole)
        : null;
    case "removed":
      return change.previousRole
        ? getOrgManagerPolicyRoleLabel(change.previousRole)
        : null;
    case "role_changed":
      return getOrgManagerPolicyRoleTransitionLabel(
        getOrgManagerPolicyRoleLabel(change.previousRole),
        getOrgManagerPolicyRoleLabel(change.nextRole),
      );
    default:
      return null;
  }
}

function PolicyHistoryChange({
  change,
  directory,
  groups,
}: {
  change: OrgManagerPrincipalMemberChange;
  directory: OrgManagerDirectory | null;
  groups: ReadonlyArray<OrgManagerGroupSummary>;
}) {
  const memberLabel = getPolicyMemberLabel({ change, directory, groups });
  const roleDetail = getPolicyChangeRoleDetail(change);

  return (
    <span
      className="org-manager-policy-change"
      title={getPolicyChangeLabel({ change, directory, groups })}
    >
      <span className="org-manager-policy-change-status">
        {getOrgManagerPolicyChangeTypeLabel(change.changeType)}
      </span>
      <span className="org-manager-policy-change-principal">
        <span className="org-manager-policy-change-principal-type">
          {getOrgManagerPolicyMemberTypeLabel(change.memberPrincipalType)}
        </span>
        <span
          className="org-manager-policy-change-principal-name"
          title={change.memberPrincipalId}
        >
          {memberLabel}
        </span>
      </span>
      {roleDetail && (
        <span className="org-manager-policy-change-role">{roleDetail}</span>
      )}
    </span>
  );
}

function getContainerDisplayLabel(
  container: Pick<
    OrgManagerGroupContainer,
    "containerDisplayName" | "containerId"
  >,
): string {
  const displayName = container.containerDisplayName?.trim();

  return displayName && displayName.length > 0
    ? displayName
    : compactFingerprint(container.containerId);
}

function getContainerDisplayTitle(
  container: Pick<
    OrgManagerGroupContainer,
    "containerDisplayName" | "containerId"
  >,
): string {
  const displayName = container.containerDisplayName?.trim();

  return displayName && displayName.length > 0
    ? `${displayName} (${container.containerId})`
    : container.containerId;
}

function isKeyboardActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}

type DirectoryRefreshOptions = {
  clearError?: boolean;
  manageLoading?: boolean;
  skipNextGroupDetailsEffect?: boolean;
};

type DirectoryRefreshResult = {
  didLoad: boolean;
  groupId: string | null;
};

type GroupDetailsRefreshOptions = {
  clearError?: boolean;
};

type GrantsRefreshOptions = {
  clearError?: boolean;
  manageLoading?: boolean;
};

type DataUsageRefreshOptions = {
  clearError?: boolean;
  manageLoading?: boolean;
};

type RefreshBehaviorOptions = {
  clearError?: boolean;
  manageLoading?: boolean;
};

function unknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setUnknownError(
  setError: (error: string | null) => void,
  error: unknown,
) {
  setError(unknownErrorMessage(error));
}

function getRefreshBehavior(options: RefreshBehaviorOptions) {
  return {
    shouldClearError: options.clearError ?? true,
    shouldManageLoading: options.manageLoading ?? true,
  };
}

function clearErrorIfRequested(
  shouldClearError: boolean,
  setError: (error: string | null) => void,
) {
  if (shouldClearError) {
    setError(null);
  }
}

function setLoadingIfManaged(
  shouldManageLoading: boolean,
  setLoading: (loading: boolean) => void,
  loading: boolean,
) {
  if (shouldManageLoading) {
    setLoading(loading);
  }
}

function directoryLoadOptions({
  skipNextGroupDetailsEffect,
}: DirectoryRefreshOptions): Pick<
  DirectoryRefreshOptions,
  "skipNextGroupDetailsEffect"
> {
  return skipNextGroupDetailsEffect === undefined
    ? {}
    : { skipNextGroupDetailsEffect };
}

function canCurrentUserMutateSelectedGroup(input: {
  directory: OrgManagerDirectory | null;
  members: OrgManagerGroupMembers | null;
  userId: string | null;
}): boolean {
  if (input.directory?.currentUser.isOrgAdmin) {
    return true;
  }

  return (
    input.members?.members.some(
      (member) =>
        member.memberPrincipalType === "user" &&
        member.memberPrincipalId === input.userId &&
        member.role === "admin",
    ) ?? false
  );
}

function DirectoryTable({
  directory,
  loading,
  selectedUserId,
  selectUser,
}: {
  directory: OrgManagerDirectory | null;
  loading: boolean;
  selectedUserId?: string | null;
  selectUser?: ((userId: string) => void) | undefined;
}) {
  if (!directory) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {loading
          ? ORG_MANAGER_LABELS.loadingDirectory
          : ORG_MANAGER_LABELS.directoryUnavailable}
      </MiniAppStatus>
    );
  }

  if (directory.users.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.noDirectUsers}
      </MiniAppStatus>
    );
  }

  return (
    <MiniAppTableFrame>
      <MiniAppTable
        aria-label={ORG_MANAGER_LABELS.directory}
        columns={DIRECTORY_TABLE_COLUMNS}
      >
        {directory.users.map((user) => {
          const isSelected = selectedUserId === user.userId;
          const openUserDetail = () => {
            selectUser?.(user.userId);
          };
          const handleUserRowKeyDown = (
            event: KeyboardEvent<HTMLTableRowElement>,
          ) => {
            if (selectUser && isKeyboardActivationKey(event.key)) {
              event.preventDefault();
              openUserDetail();
            }
          };

          return (
            <MiniAppTableRow
              aria-selected={selectUser ? isSelected : undefined}
              interactive={Boolean(selectUser)}
              key={user.userId}
              onClick={selectUser ? openUserDetail : undefined}
              onKeyDown={selectUser ? handleUserRowKeyDown : undefined}
              selected={isSelected}
              tabIndex={selectUser ? 0 : undefined}
            >
              <MiniAppTableCell>
                <MiniAppTableText title={user.userId}>
                  {user.isSelf
                    ? ORG_MANAGER_LABELS.self
                    : compactFingerprint(user.userId)}
                </MiniAppTableText>
              </MiniAppTableCell>
              <MiniAppTableCell>
                <MiniAppTableText title={user.signingKeyFingerprint}>
                  {compactFingerprint(user.signingKeyFingerprint)}
                </MiniAppTableText>
              </MiniAppTableCell>
              <MiniAppTableCell className="org-manager-directory-joined-column">
                <MiniAppTableText title={user.createdAt}>
                  {formatMiniAppDate(user.createdAt)}
                </MiniAppTableText>
              </MiniAppTableCell>
            </MiniAppTableRow>
          );
        })}
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}

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

function PolicyHistory({
  directory,
  groups,
  history,
}: {
  directory: OrgManagerDirectory | null;
  groups: ReadonlyArray<OrgManagerGroupSummary>;
  history: OrgManagerGroupPolicyHistory | OrgManagerPolicyHistory | null;
}) {
  if (!history) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.policyHistoryUnavailable}
      </MiniAppStatus>
    );
  }

  if (history.entries.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.noPolicyHistory}
      </MiniAppStatus>
    );
  }

  return (
    <div className="org-manager-policy-history">
      {history.entries.map((entry) => (
        <MiniAppRow
          className="org-manager-policy-history-row"
          density="roomy"
          key={entry.stateHash}
          variant="framed"
        >
          <MiniAppRowStack>
            <span className="org-manager-policy-history-heading">
              <strong title={entry.stateHash}>
                {getOrgManagerPolicyVersionLabel(entry.version)}
              </strong>
              <span className="org-manager-policy-history-epoch">
                {getOrgManagerEpochLabel(entry.keyEpoch)}
              </span>
            </span>
            <MiniAppRowText muted title={entry.signerUserId}>
              {getOrgManagerPolicySignatureLabel(
                formatMiniAppDate(entry.signedAt),
                compactFingerprint(entry.signerUserId),
              )}
            </MiniAppRowText>
            <span className="org-manager-policy-change-list">
              {entry.changes.length > 0 ? (
                entry.changes.map((change) => (
                  <PolicyHistoryChange
                    change={change}
                    directory={directory}
                    key={`${change.changeType}:${change.memberPrincipalType}:${change.memberPrincipalId}`}
                    groups={groups}
                  />
                ))
              ) : (
                <span className="org-manager-policy-change org-manager-policy-change--empty">
                  {ORG_MANAGER_LABELS.noMembershipChanges}
                </span>
              )}
            </span>
          </MiniAppRowStack>
        </MiniAppRow>
      ))}
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

function GrantTable({
  canRevokeGrants,
  emptyLabel,
  grants,
  label,
  mutating,
  openGroupRoute,
  revokeGrant,
}: {
  canRevokeGrants: boolean;
  emptyLabel: string;
  grants: ReadonlyArray<OrgManagerContainerGrant>;
  label: string;
  mutating: boolean;
  openGroupRoute: (groupId: string) => void;
  revokeGrant: (grant: OrgManagerContainerGrant) => void;
}) {
  if (grants.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">{emptyLabel}</MiniAppStatus>
    );
  }

  return (
    <MiniAppTableFrame>
      <MiniAppTable aria-label={label} columns={GRANT_TABLE_COLUMNS}>
        {grants.map((grant) => {
          const isGroupGrant = grant.subjectType === "group";
          const canRevokeGrant = canRevokeGrants && !grant.isBuiltin;
          const openGrantGroupRoute = () => {
            openGroupRoute(grant.subjectId);
          };
          const handleGrantRowKeyDown = (
            event: KeyboardEvent<HTMLTableRowElement>,
          ) => {
            if (isKeyboardActivationKey(event.key)) {
              event.preventDefault();
              openGrantGroupRoute();
            }
          };

          return (
            <MiniAppTableRow
              interactive={isGroupGrant}
              key={`${grant.subjectType}:${grant.subjectId}:${grant.containerId}:${grant.accessLevel}`}
              onClick={isGroupGrant ? openGrantGroupRoute : undefined}
              onKeyDown={isGroupGrant ? handleGrantRowKeyDown : undefined}
              tabIndex={isGroupGrant ? 0 : undefined}
            >
              <MiniAppTableCell>
                <MiniAppTableText title={grant.subjectId}>
                  {getGrantPrincipalLabel(grant)}
                </MiniAppTableText>
              </MiniAppTableCell>
              <MiniAppTableCell>
                <MiniAppTableText title={getContainerDisplayTitle(grant)}>
                  {getContainerDisplayLabel(grant)}
                </MiniAppTableText>
              </MiniAppTableCell>
              <MiniAppTableCell>
                <MiniAppTableText>
                  {getAccessLabel(grant.accessLevel)}
                </MiniAppTableText>
              </MiniAppTableCell>
              <MiniAppTableCell className="org-manager-container-updated-column">
                <MiniAppTableText title={grant.updatedAt}>
                  {formatMiniAppDate(grant.updatedAt)}
                </MiniAppTableText>
              </MiniAppTableCell>
              <MiniAppTableCell>
                <MiniAppButton
                  block
                  className="org-manager-grant-revoke-button"
                  disabled={!canRevokeGrant || mutating}
                  onClick={(event) => {
                    event.stopPropagation();
                    revokeGrant(grant);
                  }}
                  type="button"
                >
                  {grant.isBuiltin
                    ? ORG_MANAGER_LABELS.builtIn
                    : ORG_MANAGER_LABELS.revoke}
                </MiniAppButton>
              </MiniAppTableCell>
            </MiniAppTableRow>
          );
        })}
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}

function isSameGrantSubject(
  left: OrgManagerContainerGrant,
  right: OrgManagerContainerGrant,
): boolean {
  return (
    left.subjectType === right.subjectType && left.subjectId === right.subjectId
  );
}

function isSameContainerGrant(
  left: OrgManagerContainerGrant,
  right: OrgManagerContainerGrant,
): boolean {
  return (
    left.containerId === right.containerId && isSameGrantSubject(left, right)
  );
}

function removeRevokedGrantRows(
  grants: ReadonlyArray<OrgManagerContainerGrant>,
  revokedGrant: OrgManagerContainerGrant,
): OrgManagerContainerGrant[] {
  return grants.filter((grant) => !isSameContainerGrant(grant, revokedGrant));
}

function removeRevokedGrantFromGrantState(
  grants: OrgManagerContainerGrants | null,
  revokedGrant: OrgManagerContainerGrant,
): OrgManagerContainerGrants | null {
  return grants
    ? {
        ...grants,
        grants: removeRevokedGrantRows(grants.grants, revokedGrant),
      }
    : grants;
}

function removeRevokedGrantFromGroupContainers(
  groupContainers: OrgManagerGroupContainers | null,
  revokedGrant: OrgManagerContainerGrant,
): OrgManagerGroupContainers | null {
  if (
    !groupContainers ||
    revokedGrant.subjectType !== "group" ||
    groupContainers.groupId !== revokedGrant.subjectId
  ) {
    return groupContainers;
  }

  return {
    ...groupContainers,
    containers: groupContainers.containers.filter(
      (container) => container.containerId !== revokedGrant.containerId,
    ),
  };
}

function removeRevokedGrantFromUserDetail(
  userDetail: OrgManagerUserDetail | null,
  revokedGrant: OrgManagerContainerGrant,
): OrgManagerUserDetail | null {
  return userDetail
    ? {
        ...userDetail,
        grants: {
          directGrants: removeRevokedGrantRows(
            userDetail.grants.directGrants,
            revokedGrant,
          ),
          groupGrants: removeRevokedGrantRows(
            userDetail.grants.groupGrants,
            revokedGrant,
          ),
          organizationGrants: removeRevokedGrantRows(
            userDetail.grants.organizationGrants,
            revokedGrant,
          ),
        },
      }
    : userDetail;
}

function GrantsView({
  canRevokeGrants,
  grants,
  loading,
  mutating,
  openGroupRoute,
  revokeGrant,
}: {
  canRevokeGrants: boolean;
  grants: OrgManagerContainerGrants | null;
  loading: boolean;
  mutating: boolean;
  openGroupRoute: (groupId: string) => void;
  revokeGrant: (grant: OrgManagerContainerGrant) => void;
}) {
  if (!grants) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {loading
          ? ORG_MANAGER_LABELS.loadingGrants
          : ORG_MANAGER_LABELS.grantsUnavailable}
      </MiniAppStatus>
    );
  }

  const groupGrants = grants.grants.filter(
    (grant) => grant.subjectType === "group",
  );
  const userGrants = grants.grants.filter(
    (grant) => grant.subjectType === "user",
  );
  const organizationGrants = grants.grants.filter(
    (grant) => grant.subjectType === "organization",
  );

  return (
    <div>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.groupContainerLinks}
        </MiniAppSectionHeading>
        <GrantTable
          canRevokeGrants={canRevokeGrants}
          emptyLabel={ORG_MANAGER_LABELS.noGroupContainerLinks}
          grants={groupGrants}
          label={ORG_MANAGER_LABELS.groupContainerLinks}
          mutating={mutating}
          openGroupRoute={openGroupRoute}
          revokeGrant={revokeGrant}
        />
      </MiniAppSection>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.userContainerLinks}
        </MiniAppSectionHeading>
        <GrantTable
          canRevokeGrants={canRevokeGrants}
          emptyLabel={ORG_MANAGER_LABELS.noUserContainerLinks}
          grants={userGrants}
          label={ORG_MANAGER_LABELS.userContainerLinks}
          mutating={mutating}
          openGroupRoute={openGroupRoute}
          revokeGrant={revokeGrant}
        />
      </MiniAppSection>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.organizationContainerLinks}
        </MiniAppSectionHeading>
        <GrantTable
          canRevokeGrants={canRevokeGrants}
          emptyLabel={ORG_MANAGER_LABELS.noOrganizationContainerLinks}
          grants={organizationGrants}
          label={ORG_MANAGER_LABELS.organizationContainerLinks}
          mutating={mutating}
          openGroupRoute={openGroupRoute}
          revokeGrant={revokeGrant}
        />
      </MiniAppSection>
    </div>
  );
}

function UserGroups({
  groups,
  openGroupRoute,
}: {
  groups: ReadonlyArray<OrgManagerGroupSummary>;
  openGroupRoute: (groupId: string) => void;
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
      {groups.map((group) => (
        <MiniAppRowButton
          className="org-manager-group-button"
          density="roomy"
          key={group.groupId}
          onClick={() => openGroupRoute(group.groupId)}
        >
          <MiniAppRowStack>
            <strong>{group.name}</strong>
            <MiniAppRowText muted title={group.groupId}>
              {compactFingerprint(group.groupId)}
            </MiniAppRowText>
          </MiniAppRowStack>
        </MiniAppRowButton>
      ))}
    </div>
  );
}

function UserDetailView({
  canRevokeGrants,
  detail,
  loading,
  mutating,
  openGroupRoute,
  revokeGrant,
  selectedUserId,
}: {
  canRevokeGrants: boolean;
  detail: OrgManagerUserDetail | null;
  loading: boolean;
  mutating: boolean;
  openGroupRoute: (groupId: string) => void;
  revokeGrant: (grant: OrgManagerContainerGrant) => void;
  selectedUserId: string | null;
}) {
  if (!selectedUserId) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.selectUser}
      </MiniAppStatus>
    );
  }

  if (!detail) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {loading
          ? ORG_MANAGER_LABELS.loadingUserDetail
          : ORG_MANAGER_LABELS.userDetailUnavailable}
      </MiniAppStatus>
    );
  }

  return (
    <>
      <div className="org-manager-detail-header">
        <div>
          <strong title={detail.user.userId}>
            {detail.user.isSelf
              ? ORG_MANAGER_LABELS.self
              : compactFingerprint(detail.user.userId)}
          </strong>
          <span title={detail.user.signingKeyFingerprint}>
            {compactFingerprint(detail.user.signingKeyFingerprint)}
          </span>
        </div>
        <span title={detail.user.createdAt}>
          {formatMiniAppDate(detail.user.createdAt)}
        </span>
      </div>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.groups}
        </MiniAppSectionHeading>
        <UserGroups groups={detail.groups} openGroupRoute={openGroupRoute} />
      </MiniAppSection>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.userContainerLinks}
        </MiniAppSectionHeading>
        <GrantTable
          canRevokeGrants={canRevokeGrants}
          emptyLabel={ORG_MANAGER_LABELS.noUserContainerLinks}
          grants={detail.grants.directGrants}
          label={ORG_MANAGER_LABELS.userContainerLinks}
          mutating={mutating}
          openGroupRoute={openGroupRoute}
          revokeGrant={revokeGrant}
        />
      </MiniAppSection>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.groupContainerLinks}
        </MiniAppSectionHeading>
        <GrantTable
          canRevokeGrants={canRevokeGrants}
          emptyLabel={ORG_MANAGER_LABELS.noGroupContainerLinks}
          grants={detail.grants.groupGrants}
          label={ORG_MANAGER_LABELS.groupContainerLinks}
          mutating={mutating}
          openGroupRoute={openGroupRoute}
          revokeGrant={revokeGrant}
        />
      </MiniAppSection>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.organizationContainerLinks}
        </MiniAppSectionHeading>
        <GrantTable
          canRevokeGrants={canRevokeGrants}
          emptyLabel={ORG_MANAGER_LABELS.noOrganizationContainerLinks}
          grants={detail.grants.organizationGrants}
          label={ORG_MANAGER_LABELS.organizationContainerLinks}
          mutating={mutating}
          openGroupRoute={openGroupRoute}
          revokeGrant={revokeGrant}
        />
      </MiniAppSection>
    </>
  );
}

function DirectoryView({
  canRevokeGrants,
  detail,
  directory,
  loading,
  loadingUserDetail,
  mutating,
  openGroupRoute,
  revokeGrant,
  selectedUserId,
  selectUser,
}: {
  canRevokeGrants: boolean;
  detail: OrgManagerUserDetail | null;
  directory: OrgManagerDirectory | null;
  loading: boolean;
  loadingUserDetail: boolean;
  mutating: boolean;
  openGroupRoute: (groupId: string) => void;
  revokeGrant: (grant: OrgManagerContainerGrant) => void;
  selectedUserId: string | null;
  selectUser: (userId: string) => void;
}) {
  if (!directory) {
    return <DirectoryTable directory={directory} loading={loading} />;
  }

  return (
    <div className="org-manager-groups">
      <section className="org-manager-panel">
        <DirectoryTable
          directory={directory}
          loading={loading}
          selectedUserId={selectedUserId}
          selectUser={selectUser}
        />
      </section>
      <section className="org-manager-panel org-manager-panel--detail">
        <UserDetailView
          canRevokeGrants={canRevokeGrants}
          detail={detail}
          loading={loadingUserDetail}
          mutating={mutating}
          openGroupRoute={openGroupRoute}
          revokeGrant={revokeGrant}
          selectedUserId={selectedUserId}
        />
      </section>
    </div>
  );
}

function getUsageCountLabel(
  count: number,
  singular: string,
  plural: string,
): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

function UsageMetric({
  byteLength,
  detail,
  label,
}: {
  byteLength: number;
  detail: string;
  label: string;
}) {
  return (
    <MiniAppRow className="org-manager-usage-row" density="roomy">
      <MiniAppRowStack>
        <strong>{label}</strong>
        <MiniAppRowText muted>{detail}</MiniAppRowText>
      </MiniAppRowStack>
      <strong
        title={`${byteLength.toLocaleString()} ${ORG_MANAGER_LABELS.usageBytesUnit}`}
      >
        {formatByteLength(byteLength)}
      </strong>
    </MiniAppRow>
  );
}

function DataUsageView({
  dataUsage,
  loading,
}: {
  dataUsage: OrgManagerDataUsage | null;
  loading: boolean;
}) {
  if (!dataUsage) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {loading
          ? ORG_MANAGER_LABELS.loadingDataUsage
          : ORG_MANAGER_LABELS.usageUnavailable}
      </MiniAppStatus>
    );
  }

  return (
    <div>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.organizationDataUsage}
        </MiniAppSectionHeading>
        <UsageMetric
          byteLength={dataUsage.totalByteLength}
          detail={ORG_MANAGER_LABELS.usageData}
          label={ORG_MANAGER_LABELS.usageTotal}
        />
      </MiniAppSection>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.usageDocuments}
        </MiniAppSectionHeading>
        <UsageMetric
          byteLength={dataUsage.documents.byteLength}
          detail={`${getUsageCountLabel(
            dataUsage.documents.documentCount,
            ORG_MANAGER_LABELS.usageDocument,
            ORG_MANAGER_LABELS.usageDocumentsUnit,
          )}, ${getUsageCountLabel(
            dataUsage.documents.updateCount,
            ORG_MANAGER_LABELS.usageUpdate,
            ORG_MANAGER_LABELS.usageUpdatesUnit,
          )}`}
          label={ORG_MANAGER_LABELS.usageDocuments}
        />
      </MiniAppSection>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.usageBlobs}
        </MiniAppSectionHeading>
        <UsageMetric
          byteLength={dataUsage.blobs.byteLength}
          detail={getUsageCountLabel(
            dataUsage.blobs.blobCount,
            ORG_MANAGER_LABELS.usageBlob,
            ORG_MANAGER_LABELS.usageBlobsUnit,
          )}
          label={ORG_MANAGER_LABELS.usageBlobs}
        />
      </MiniAppSection>
    </div>
  );
}

function OrganizationView({
  directory,
  groups,
  organizationId,
  policyHistory,
}: {
  directory: OrgManagerDirectory | null;
  groups: ReadonlyArray<OrgManagerGroupSummary>;
  organizationId: string;
  policyHistory: OrgManagerPolicyHistory | null;
}) {
  return (
    <div>
      <div className="org-manager-detail-header">
        <div>
          <strong>{ORG_MANAGER_LABELS.organization}</strong>
          <span title={organizationId}>
            {compactFingerprint(organizationId)}
          </span>
        </div>
      </div>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.organizationPolicyHistory}
        </MiniAppSectionHeading>
        <PolicyHistory
          directory={directory}
          groups={groups}
          history={policyHistory}
        />
      </MiniAppSection>
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The mini-app shell coordinates shared async state across the directory and group panes.
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The mini-app shell coordinates shared async state across the directory and group panes.
export function OrgManager() {
  const appData = useAppData();
  const orgManagerActions = useOrgManagerActions();
  const addUserListId = useId();
  const [directory, setDirectory] = useState<OrgManagerDirectory | null>(null);
  const [groups, setGroups] = useState<ReadonlyArray<OrgManagerGroupSummary>>(
    [],
  );
  const {
    openGroupRoute,
    route,
    selectedGroupId,
    selectedGroupIdRef,
    setSelectedGroupId: selectGroup,
    setView,
  } = useOrgManagerRoute({ groups });
  const view = route.view;
  const [members, setMembers] = useState<OrgManagerGroupMembers | null>(null);
  const [groupContainers, setGroupContainers] =
    useState<OrgManagerGroupContainers | null>(null);
  const [groupPolicyHistory, setGroupPolicyHistory] =
    useState<OrgManagerGroupPolicyHistory | null>(null);
  const [organizationPolicyHistory, setOrganizationPolicyHistory] =
    useState<OrgManagerPolicyHistory | null>(null);
  const [grants, setGrants] = useState<OrgManagerContainerGrants | null>(null);
  const [dataUsage, setDataUsage] = useState<OrgManagerDataUsage | null>(null);
  const [selectedUserId, setSelectedUserIdState] = useState<string | null>(
    null,
  );
  const [userDetail, setUserDetail] = useState<OrgManagerUserDetail | null>(
    null,
  );
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [addUserId, setAddUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingUserDetail, setLoadingUserDetail] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skippedGroupDetailsEffectRef = useRef<{
    groupId: string | null;
  } | null>(null);
  const selectedUserIdRef = useRef<string | null>(null);
  const canLoadAuthenticatedOrgData = Boolean(
    appData.organizationId && appData.isAuthenticated,
  );
  useMiniAppMessage(
    "org-manager",
    useCallback(
      (message) => {
        if (message.type === "open-group") {
          openGroupRoute(message.groupId);
        }
      },
      [openGroupRoute],
    ),
  );

  const selectedGroup =
    groups.find((group) => group.groupId === selectedGroupId) ?? null;
  const canCreateGroup = directory?.currentUser.isOrgAdmin ?? false;
  const canMutateSelectedGroup = canCurrentUserMutateSelectedGroup({
    directory,
    members,
    userId: appData.userId,
  });

  const memberUserIds = useMemo(
    () =>
      new Set(
        members?.members
          .filter((member) => member.memberPrincipalType === "user")
          .map((member) => member.memberPrincipalId) ?? [],
      ),
    [members],
  );
  const addableUsers = useMemo(
    () =>
      directory?.users.filter((user) => !memberUserIds.has(user.userId)) ?? [],
    [directory, memberUserIds],
  );
  const canRevokeGrants = directory?.currentUser.isOrgAdmin ?? false;

  const selectUser = useCallback((userId: string | null) => {
    selectedUserIdRef.current = userId;
    setSelectedUserIdState(userId);
    setUserDetail(null);
  }, []);

  const resetDirectoryState = useCallback(() => {
    setDirectory(null);
    setGroups([]);
    setMembers(null);
    setGroupContainers(null);
    setGroupPolicyHistory(null);
    setOrganizationPolicyHistory(null);
    setGrants(null);
    setDataUsage(null);
    selectUser(null);
    selectGroup(null);
  }, [selectGroup, selectUser]);

  const loadDirectoryAndGroups = useCallback(
    async (
      options: Pick<DirectoryRefreshOptions, "skipNextGroupDetailsEffect"> = {},
    ): Promise<DirectoryRefreshResult> => {
      if (!appData.organizationId || !appData.isAuthenticated) {
        resetDirectoryState();
        return { didLoad: false, groupId: null };
      }

      const nextDirectoryState =
        await orgManagerActions.loadDirectoryAndGroups();

      if (nextDirectoryState === null) {
        resetDirectoryState();
        setError(ORG_MANAGER_LABELS.failedLoadDirectoryGroups);
        return { didLoad: false, groupId: null };
      }

      setDirectory(nextDirectoryState.directory);
      setGroups(nextDirectoryState.groups);
      const currentSelectedGroupId = selectedGroupIdRef.current;
      const nextSelectedGroupId = resolveOrgManagerSelectedGroupId(
        currentSelectedGroupId,
        nextDirectoryState.groups,
      );
      if (
        options.skipNextGroupDetailsEffect &&
        nextSelectedGroupId !== currentSelectedGroupId
      ) {
        skippedGroupDetailsEffectRef.current = { groupId: nextSelectedGroupId };
      }
      selectGroup(nextSelectedGroupId);
      return { didLoad: true, groupId: nextSelectedGroupId };
    },
    [
      appData.isAuthenticated,
      appData.organizationId,
      orgManagerActions,
      resetDirectoryState,
      selectGroup,
    ],
  );

  const refreshDirectoryAndGroups = useCallback(
    async (
      options: DirectoryRefreshOptions = {},
    ): Promise<DirectoryRefreshResult> => {
      const { shouldClearError, shouldManageLoading } =
        getRefreshBehavior(options);
      setLoadingIfManaged(shouldManageLoading, setLoading, true);
      clearErrorIfRequested(shouldClearError, setError);

      try {
        return await loadDirectoryAndGroups(directoryLoadOptions(options));
      } catch (nextError) {
        setUnknownError(setError, nextError);
        return { didLoad: false, groupId: selectedGroupIdRef.current };
      } finally {
        setLoadingIfManaged(shouldManageLoading, setLoading, false);
      }
    },
    [loadDirectoryAndGroups],
  );

  const refreshSelectedGroupDetails = useCallback(
    async (
      groupId: string | null,
      options: GroupDetailsRefreshOptions = {},
    ) => {
      const shouldClearError = options.clearError ?? true;
      if (!appData.organizationId || !groupId || !appData.isAuthenticated) {
        setMembers(null);
        setGroupContainers(null);
        setGroupPolicyHistory(null);
        return;
      }

      if (shouldClearError) {
        setError(null);
      }
      try {
        const {
          containers: nextContainers,
          members: nextMembers,
          policyHistory: nextPolicyHistory,
        } = await orgManagerActions.loadGroupDetails(groupId);
        const errors: string[] = [];

        if (nextMembers === null) {
          setMembers(null);
          errors.push(ORG_MANAGER_LABELS.failedLoadGroupMembers);
        } else {
          setMembers(nextMembers);
        }

        if (nextContainers === null) {
          setGroupContainers(null);
          errors.push(ORG_MANAGER_LABELS.failedLoadGroupContainers);
        } else {
          setGroupContainers(nextContainers);
        }

        setGroupPolicyHistory(nextPolicyHistory);

        if (errors.length > 0) {
          setError(errors.join(" "));
        }
      } catch (nextError) {
        setMembers(null);
        setGroupContainers(null);
        setGroupPolicyHistory(null);
        setUnknownError(setError, nextError);
      }
    },
    [appData.isAuthenticated, appData.organizationId, orgManagerActions],
  );

  const refreshGrants = useCallback(
    async (options: GrantsRefreshOptions = {}) => {
      const { shouldClearError, shouldManageLoading } =
        getRefreshBehavior(options);
      if (!canLoadAuthenticatedOrgData) {
        setGrants(null);
        return;
      }

      setLoadingIfManaged(shouldManageLoading, setLoading, true);
      clearErrorIfRequested(shouldClearError, setError);

      try {
        const nextGrants = await orgManagerActions.loadGrants();
        if (nextGrants === null) {
          setGrants(null);
          setError(ORG_MANAGER_LABELS.failedLoadGrants);
          return;
        }

        setGrants(nextGrants);
      } catch (nextError) {
        setGrants(null);
        setUnknownError(setError, nextError);
      } finally {
        setLoadingIfManaged(shouldManageLoading, setLoading, false);
      }
    },
    [canLoadAuthenticatedOrgData, orgManagerActions],
  );

  const refreshDataUsage = useCallback(
    async (options: DataUsageRefreshOptions = {}) => {
      const { shouldClearError, shouldManageLoading } =
        getRefreshBehavior(options);
      if (!canLoadAuthenticatedOrgData) {
        setDataUsage(null);
        return;
      }

      setLoadingIfManaged(shouldManageLoading, setLoading, true);
      clearErrorIfRequested(shouldClearError, setError);

      try {
        const nextUsage = await orgManagerActions.loadDataUsage();
        if (nextUsage === null) {
          setDataUsage(null);
          setError(ORG_MANAGER_LABELS.failedLoadDataUsage);
          return;
        }

        setDataUsage(nextUsage);
      } catch (nextError) {
        setDataUsage(null);
        setUnknownError(setError, nextError);
      } finally {
        setLoadingIfManaged(shouldManageLoading, setLoading, false);
      }
    },
    [canLoadAuthenticatedOrgData, orgManagerActions],
  );

  const refreshOrganizationPolicyHistory = useCallback(
    async (options: RefreshBehaviorOptions = {}) => {
      const { shouldClearError, shouldManageLoading } =
        getRefreshBehavior(options);
      if (!canLoadAuthenticatedOrgData) {
        setOrganizationPolicyHistory(null);
        return;
      }

      setLoadingIfManaged(shouldManageLoading, setLoading, true);
      clearErrorIfRequested(shouldClearError, setError);

      try {
        setOrganizationPolicyHistory(
          await orgManagerActions.loadPolicyHistory(),
        );
      } catch (nextError) {
        setOrganizationPolicyHistory(null);
        setUnknownError(setError, nextError);
      } finally {
        setLoadingIfManaged(shouldManageLoading, setLoading, false);
      }
    },
    [canLoadAuthenticatedOrgData, orgManagerActions],
  );

  const refreshSelectedUserDetail = useCallback(
    async (userId: string | null, options: GroupDetailsRefreshOptions = {}) => {
      const shouldClearError = options.clearError ?? true;
      if (!canLoadAuthenticatedOrgData || !userId) {
        setUserDetail(null);
        setLoadingUserDetail(false);
        return;
      }

      setLoadingUserDetail(true);
      if (shouldClearError) {
        setError(null);
      }
      try {
        const nextDetail = await orgManagerActions.loadUserDetail(userId);
        if (nextDetail === null) {
          setUserDetail(null);
          setError(ORG_MANAGER_LABELS.failedLoadUserDetail);
          return;
        }

        setUserDetail(nextDetail);
      } catch (nextError) {
        setUserDetail(null);
        setUnknownError(setError, nextError);
      } finally {
        setLoadingUserDetail(false);
      }
    },
    [canLoadAuthenticatedOrgData, orgManagerActions],
  );

  const refreshOrgManager = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [refreshedDirectory] = await Promise.all([
        refreshDirectoryAndGroups({
          clearError: false,
          manageLoading: false,
          skipNextGroupDetailsEffect: true,
        }),
        refreshGrants({
          clearError: false,
          manageLoading: false,
        }),
        refreshDataUsage({
          clearError: false,
          manageLoading: false,
        }),
        refreshOrganizationPolicyHistory({
          clearError: false,
          manageLoading: false,
        }),
      ]);
      if (refreshedDirectory.didLoad) {
        await refreshSelectedGroupDetails(refreshedDirectory.groupId, {
          clearError: false,
        });
      }
      await refreshSelectedUserDetail(selectedUserIdRef.current, {
        clearError: false,
      });
    } finally {
      setLoading(false);
    }
  }, [
    refreshDataUsage,
    refreshDirectoryAndGroups,
    refreshGrants,
    refreshOrganizationPolicyHistory,
    refreshSelectedGroupDetails,
    refreshSelectedUserDetail,
  ]);

  useEffect(() => {
    void refreshOrgManager();
  }, [refreshOrgManager]);

  useEffect(() => {
    const skippedGroupDetailsEffect = skippedGroupDetailsEffectRef.current;
    if (skippedGroupDetailsEffect?.groupId === selectedGroupId) {
      skippedGroupDetailsEffectRef.current = null;
      return;
    }

    void refreshSelectedGroupDetails(selectedGroupId);
  }, [refreshSelectedGroupDetails, selectedGroupId]);

  useEffect(() => {
    if (
      directory &&
      selectedUserId &&
      !directory.users.some((user) => user.userId === selectedUserId)
    ) {
      selectUser(null);
    }
  }, [directory, selectedUserId, selectUser]);

  useEffect(() => {
    void refreshSelectedUserDetail(selectedUserId);
  }, [refreshSelectedUserDetail, selectedUserId]);

  const createGroup = useCallback(async () => {
    if (
      !appData.organizationId ||
      !appData.userId ||
      !appData.signingFingerprint ||
      !appData.signingKeyPair ||
      !appData.encapsulationKeyPair ||
      groupNameDraft.trim().length === 0
    ) {
      return;
    }

    setMutating(true);
    setError(null);
    try {
      const createdGroup = await orgManagerActions.createGroup(groupNameDraft);
      setGroupNameDraft("");
      await refreshDirectoryAndGroups();
      openGroupRoute(createdGroup.groupId);
    } catch (nextError) {
      setUnknownError(setError, nextError);
    } finally {
      setMutating(false);
    }
  }, [
    appData.encapsulationKeyPair,
    appData.organizationId,
    appData.signingFingerprint,
    appData.signingKeyPair,
    appData.userId,
    groupNameDraft,
    openGroupRoute,
    orgManagerActions,
    refreshDirectoryAndGroups,
  ]);

  const addUser = useCallback(async () => {
    const targetUserId = addUserId.trim();
    const directoryUser = directory?.users.find(
      (user) => user.userId === targetUserId,
    );
    if (
      !directory ||
      !members ||
      targetUserId.length === 0 ||
      !selectedGroupId ||
      !appData.userId ||
      !appData.signingFingerprint ||
      !appData.signingKeyPair ||
      !appData.encapsulationKeyPair
    ) {
      return;
    }

    setMutating(true);
    setError(null);
    try {
      const targetUser = directoryUser
        ? userRecipient(directoryUser)
        : await orgManagerActions.importUserById(targetUserId);
      if (!targetUser) {
        setError(ORG_MANAGER_LABELS.userNotFound);
        return;
      }

      await orgManagerActions.addUserToGroup(
        selectedGroupId,
        targetUser,
        currentGroupUserRecipients({ directory, members }),
        directory.currentUser.isOrgAdmin,
      );
      setAddUserId("");
      const refreshedDirectory = await refreshDirectoryAndGroups({
        skipNextGroupDetailsEffect: true,
      });
      if (refreshedDirectory.didLoad) {
        await refreshSelectedGroupDetails(refreshedDirectory.groupId);
      }
      await refreshSelectedUserDetail(selectedUserIdRef.current);
    } catch (nextError) {
      setUnknownError(setError, nextError);
    } finally {
      setMutating(false);
    }
  }, [
    addUserId,
    appData.encapsulationKeyPair,
    appData.signingFingerprint,
    appData.signingKeyPair,
    appData.userId,
    directory,
    members,
    orgManagerActions,
    refreshDirectoryAndGroups,
    refreshSelectedGroupDetails,
    refreshSelectedUserDetail,
    selectedGroupId,
  ]);

  const removeMember = useCallback(
    async (removedUserId: string) => {
      if (
        !selectedGroupId ||
        !appData.userId ||
        !appData.signingFingerprint ||
        !appData.signingKeyPair ||
        !directory
      ) {
        return;
      }

      setMutating(true);
      setError(null);
      try {
        await orgManagerActions.removeUserFromGroup(
          selectedGroupId,
          removedUserId,
          currentGroupUserRecipients({ directory, members }).filter(
            (user) => user.userId !== removedUserId,
          ),
          directory.currentUser.isOrgAdmin,
        );
        const refreshedDirectory = await refreshDirectoryAndGroups({
          skipNextGroupDetailsEffect: true,
        });
        if (refreshedDirectory.didLoad) {
          await refreshSelectedGroupDetails(refreshedDirectory.groupId);
        }
        await refreshSelectedUserDetail(selectedUserIdRef.current);
      } catch (nextError) {
        setUnknownError(setError, nextError);
      } finally {
        setMutating(false);
      }
    },
    [
      appData.signingFingerprint,
      appData.signingKeyPair,
      appData.userId,
      directory,
      members,
      orgManagerActions,
      refreshDirectoryAndGroups,
      refreshSelectedGroupDetails,
      refreshSelectedUserDetail,
      selectedGroupId,
    ],
  );

  const revokeGrant = useCallback(
    async (grant: OrgManagerContainerGrant) => {
      if (grant.isBuiltin) {
        return;
      }

      setMutating(true);
      setError(null);
      try {
        await orgManagerActions.revokeGrant(grant);
        setGrants((currentGrants) =>
          removeRevokedGrantFromGrantState(currentGrants, grant),
        );
        setGroupContainers((currentGroupContainers) =>
          removeRevokedGrantFromGroupContainers(currentGroupContainers, grant),
        );
        setUserDetail((currentUserDetail) =>
          removeRevokedGrantFromUserDetail(currentUserDetail, grant),
        );
      } catch (nextError) {
        setUnknownError(setError, nextError);
      } finally {
        setMutating(false);
      }
    },
    [orgManagerActions],
  );

  useOrgManagerSidebarPanel({
    enabled: Boolean(appData.organizationId && appData.isAuthenticated),
    setView,
    view,
  });
  useWindowRefreshMenuItem(
    appData.organizationId && appData.isAuthenticated
      ? {
          disabled: loading || mutating,
          onRefresh: refreshOrgManager,
          refreshing: loading,
        }
      : null,
  );

  if (!appData.organizationId || !appData.isAuthenticated) {
    return (
      <MiniAppRoot centered>
        <MiniAppStatus className="org-manager-hint">
          {ORG_MANAGER_LABELS.authenticate}
        </MiniAppStatus>
      </MiniAppRoot>
    );
  }

  return (
    <MiniAppRoot>
      <main className="org-manager-main">
        {error && (
          <MiniAppStatus className="org-manager-error" tone="error">
            {error}
          </MiniAppStatus>
        )}
        {view === "directory" ? (
          <DirectoryView
            canRevokeGrants={canRevokeGrants}
            detail={userDetail}
            directory={directory}
            loading={loading}
            loadingUserDetail={loadingUserDetail}
            mutating={mutating}
            openGroupRoute={openGroupRoute}
            revokeGrant={revokeGrant}
            selectedUserId={selectedUserId}
            selectUser={selectUser}
          />
        ) : view === "grants" ? (
          <GrantsView
            canRevokeGrants={canRevokeGrants}
            grants={grants}
            loading={loading}
            mutating={mutating}
            openGroupRoute={openGroupRoute}
            revokeGrant={revokeGrant}
          />
        ) : view === "organization" ? (
          <OrganizationView
            directory={directory}
            groups={groups}
            organizationId={appData.organizationId}
            policyHistory={organizationPolicyHistory}
          />
        ) : view === "usage" ? (
          <DataUsageView dataUsage={dataUsage} loading={loading} />
        ) : (
          <div className="org-manager-groups">
            <section className="org-manager-panel">
              <div className="org-manager-create-group">
                <MiniAppInput
                  disabled={!canCreateGroup || mutating}
                  onChange={(event) => setGroupNameDraft(event.target.value)}
                  placeholder={ORG_MANAGER_LABELS.groupName}
                  value={groupNameDraft}
                />
                <MiniAppButton
                  disabled={
                    !canCreateGroup ||
                    mutating ||
                    groupNameDraft.trim().length === 0
                  }
                  onClick={createGroup}
                >
                  {ORG_MANAGER_LABELS.create}
                </MiniAppButton>
              </div>
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
                        ? getOrgManagerEpochLabel(
                            selectedGroup.currentState.keyEpoch,
                          )
                        : ORG_MANAGER_LABELS.noPolicy}
                    </span>
                  </div>
                  <div className="org-manager-add-user">
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
                  </div>
                  <MiniAppSection>
                    <MiniAppSectionHeading>
                      {ORG_MANAGER_LABELS.members}
                    </MiniAppSectionHeading>
                    <GroupMembers
                      canMutateGroup={canMutateSelectedGroup}
                      members={members?.members ?? []}
                      mutating={mutating}
                      removeMember={removeMember}
                      userId={appData.userId}
                    />
                  </MiniAppSection>
                  <MiniAppSection>
                    <MiniAppSectionHeading>
                      {ORG_MANAGER_LABELS.policyHistory}
                    </MiniAppSectionHeading>
                    <PolicyHistory
                      directory={directory}
                      groups={groups}
                      history={groupPolicyHistory}
                    />
                  </MiniAppSection>
                  <MiniAppSection>
                    <MiniAppSectionHeading>
                      {ORG_MANAGER_LABELS.directContainerLinks}
                    </MiniAppSectionHeading>
                    <GroupContainers
                      containers={groupContainers?.containers ?? []}
                    />
                  </MiniAppSection>
                </>
              ) : (
                <MiniAppStatus className="org-manager-hint">
                  {ORG_MANAGER_LABELS.selectGroup}
                </MiniAppStatus>
              )}
            </section>
          </div>
        )}
      </main>
    </MiniAppRoot>
  );
}
