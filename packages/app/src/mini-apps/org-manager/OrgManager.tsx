import type {
  OrganizationDirectoryResponse,
  OrganizationDirectoryUserResponse,
  OrganizationGroupContainerResponse,
  OrganizationGroupContainersResponse,
  OrganizationGroupMemberResponse,
  OrganizationGroupMembersResponse,
  OrganizationGroupSummaryResponse,
} from "@tearleads/validators/response";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
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
  type OrgManagerUserRecipient,
  useOrgManagerActions,
} from "../../stores/org-manager/OrgManagerProvider";
import { formatMiniAppDate } from "../../utils/formatMiniAppDate";
import {
  getOrgManagerEpochLabel,
  getOrgManagerMemberCountLabel,
  ORG_MANAGER_LABELS,
} from "./labels";
import "./OrgManager.css";
import {
  type OrgManagerView,
  useOrgManagerSidebarPanel,
} from "./OrgManagerSidebar";

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

const ACCESS_LEVEL_LABELS = {
  admin: ORG_MANAGER_LABELS.accessAdmin,
  read: ORG_MANAGER_LABELS.accessRead,
  write: ORG_MANAGER_LABELS.accessWrite,
} satisfies Record<OrganizationGroupContainerResponse["accessLevel"], string>;

function userRecipient(
  user: OrganizationDirectoryUserResponse,
): OrgManagerUserRecipient {
  return {
    userId: user.userId,
    encapsulationPublicKey: user.encapsulationPublicKey,
    encapsulationKeyFingerprint: user.encapsulationKeyFingerprint,
  };
}

function memberUserRecipient(
  member: OrganizationGroupMemberResponse,
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
  directory: OrganizationDirectoryResponse;
  members: OrganizationGroupMembersResponse | null;
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
  accessLevel: OrganizationGroupContainerResponse["accessLevel"],
): string {
  return ACCESS_LEVEL_LABELS[accessLevel];
}

function canCurrentUserMutateSelectedGroup(input: {
  directory: OrganizationDirectoryResponse | null;
  members: OrganizationGroupMembersResponse | null;
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
}: {
  directory: OrganizationDirectoryResponse | null;
  loading: boolean;
}) {
  if (!directory) {
    return (
      <div className="org-manager-hint">
        {loading
          ? ORG_MANAGER_LABELS.loadingDirectory
          : ORG_MANAGER_LABELS.directoryUnavailable}
      </div>
    );
  }

  if (directory.users.length === 0) {
    return (
      <div className="org-manager-hint">{ORG_MANAGER_LABELS.noDirectUsers}</div>
    );
  }

  return (
    <MiniAppTableFrame>
      <MiniAppTable
        aria-label={ORG_MANAGER_LABELS.directory}
        columns={DIRECTORY_TABLE_COLUMNS}
      >
        {directory.users.map((user) => (
          <MiniAppTableRow key={user.userId}>
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
        ))}
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}

function GroupList({
  groups,
  selectedGroupId,
  setSelectedGroupId,
}: {
  groups: ReadonlyArray<OrganizationGroupSummaryResponse>;
  selectedGroupId: string | null;
  setSelectedGroupId: (groupId: string) => void;
}) {
  if (groups.length === 0) {
    return (
      <div className="org-manager-hint">{ORG_MANAGER_LABELS.noGroups}</div>
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
  members: ReadonlyArray<OrganizationGroupMemberResponse>;
  mutating: boolean;
  removeMember: (userId: string) => void;
  userId: string | null;
}) {
  if (members.length === 0) {
    return (
      <div className="org-manager-hint">
        {ORG_MANAGER_LABELS.noGroupMembers}
      </div>
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
              <button
                disabled={!canRemove || mutating}
                onClick={() => removeMember(member.memberPrincipalId)}
                type="button"
              >
                {ORG_MANAGER_LABELS.remove}
              </button>
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
  containers: ReadonlyArray<OrganizationGroupContainerResponse>;
}) {
  if (containers.length === 0) {
    return (
      <div className="org-manager-hint">
        {ORG_MANAGER_LABELS.noDirectContainerLinks}
      </div>
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
              <MiniAppTableText title={container.containerId}>
                {compactFingerprint(container.containerId)}
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The mini-app shell coordinates shared async state across the directory and group panes.
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The mini-app shell coordinates shared async state across the directory and group panes.
export function OrgManager() {
  const appData = useAppData();
  const orgManagerActions = useOrgManagerActions();
  const addUserListId = useId();
  const [view, setView] = useState<OrgManagerView>("directory");
  const [directory, setDirectory] =
    useState<OrganizationDirectoryResponse | null>(null);
  const [groups, setGroups] = useState<OrganizationGroupSummaryResponse[]>([]);
  const [members, setMembers] =
    useState<OrganizationGroupMembersResponse | null>(null);
  const [groupContainers, setGroupContainers] =
    useState<OrganizationGroupContainersResponse | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [addUserId, setAddUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedGroupIdRef = useRef(selectedGroupId);

  const selectGroup = useCallback((groupId: string | null) => {
    selectedGroupIdRef.current = groupId;
    setSelectedGroupId(groupId);
  }, []);

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

  const refreshDirectoryAndGroups = useCallback(async () => {
    if (!appData.organizationId || !appData.isAuthenticated) {
      setDirectory(null);
      setGroups([]);
      setMembers(null);
      setGroupContainers(null);
      selectGroup(null);
      return null;
    }

    setLoading(true);
    setError(null);
    try {
      const [nextDirectory, nextGroups] = await Promise.all([
        appData.apiClient.listOrganizationDirectory(appData.organizationId),
        appData.apiClient.listOrganizationGroups(appData.organizationId),
      ]);

      if (nextDirectory === null || nextGroups === null) {
        setDirectory(null);
        setGroups([]);
        setMembers(null);
        setGroupContainers(null);
        selectGroup(null);
        setError(ORG_MANAGER_LABELS.failedLoadDirectoryGroups);
        return null;
      }

      setDirectory(nextDirectory);
      setGroups(nextGroups.groups);
      const nextSelectedGroupId =
        selectedGroupIdRef.current &&
        nextGroups.groups.some(
          (group) => group.groupId === selectedGroupIdRef.current,
        )
          ? selectedGroupIdRef.current
          : (nextGroups.groups[0]?.groupId ?? null);
      selectGroup(nextSelectedGroupId);
      return nextSelectedGroupId;
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
      return selectedGroupIdRef.current;
    } finally {
      setLoading(false);
    }
  }, [
    appData.apiClient,
    appData.isAuthenticated,
    appData.organizationId,
    selectGroup,
  ]);

  const refreshSelectedGroupMembers = useCallback(
    async (groupId: string | null) => {
      if (!appData.organizationId || !groupId || !appData.isAuthenticated) {
        setMembers(null);
        return;
      }

      setError(null);
      try {
        const nextMembers =
          await appData.apiClient.listOrganizationGroupMembers(
            appData.organizationId,
            groupId,
          );
        if (nextMembers === null) {
          setMembers(null);
          setError(ORG_MANAGER_LABELS.failedLoadGroupMembers);
          return;
        }

        setMembers(nextMembers);
      } catch (nextError) {
        setMembers(null);
        setError(
          nextError instanceof Error ? nextError.message : String(nextError),
        );
      }
    },
    [appData.apiClient, appData.isAuthenticated, appData.organizationId],
  );

  const refreshSelectedGroupContainers = useCallback(
    async (groupId: string | null) => {
      if (!appData.organizationId || !groupId || !appData.isAuthenticated) {
        setGroupContainers(null);
        return;
      }

      setError(null);
      try {
        const nextContainers =
          await appData.apiClient.listOrganizationGroupContainers(
            appData.organizationId,
            groupId,
          );
        if (nextContainers === null) {
          setGroupContainers(null);
          setError(ORG_MANAGER_LABELS.failedLoadGroupContainers);
          return;
        }

        setGroupContainers(nextContainers);
      } catch (nextError) {
        setGroupContainers(null);
        setError(
          nextError instanceof Error ? nextError.message : String(nextError),
        );
      }
    },
    [appData.apiClient, appData.isAuthenticated, appData.organizationId],
  );

  const refreshOrgManager = useCallback(async () => {
    const refreshedGroupId = await refreshDirectoryAndGroups();
    await Promise.all([
      refreshSelectedGroupMembers(refreshedGroupId),
      refreshSelectedGroupContainers(refreshedGroupId),
    ]);
  }, [
    refreshDirectoryAndGroups,
    refreshSelectedGroupContainers,
    refreshSelectedGroupMembers,
  ]);

  useEffect(() => {
    void refreshDirectoryAndGroups();
  }, [refreshDirectoryAndGroups]);

  useEffect(() => {
    void refreshSelectedGroupMembers(selectedGroupId);
  }, [refreshSelectedGroupMembers, selectedGroupId]);

  useEffect(() => {
    void refreshSelectedGroupContainers(selectedGroupId);
  }, [refreshSelectedGroupContainers, selectedGroupId]);

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
      setView("groups");
      selectGroup(createdGroup.groupId);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
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
    orgManagerActions,
    refreshDirectoryAndGroups,
    selectGroup,
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
      await refreshDirectoryAndGroups();
      await refreshSelectedGroupMembers(selectedGroupId);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
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
    refreshSelectedGroupMembers,
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
        await refreshDirectoryAndGroups();
        await refreshSelectedGroupMembers(selectedGroupId);
      } catch (nextError) {
        setError(
          nextError instanceof Error ? nextError.message : String(nextError),
        );
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
      refreshSelectedGroupMembers,
      selectedGroupId,
    ],
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
      <div className="org-manager org-manager--empty">
        <div className="org-manager-hint">
          {ORG_MANAGER_LABELS.authenticate}
        </div>
      </div>
    );
  }

  return (
    <div className="org-manager">
      <main className="org-manager-main">
        {error && <div className="org-manager-error">{error}</div>}
        {view === "directory" ? (
          <DirectoryTable directory={directory} loading={loading} />
        ) : (
          <div className="org-manager-groups">
            <section className="org-manager-panel">
              <div className="org-manager-create-group">
                <input
                  disabled={!canCreateGroup || mutating}
                  onChange={(event) => setGroupNameDraft(event.target.value)}
                  placeholder={ORG_MANAGER_LABELS.groupName}
                  value={groupNameDraft}
                />
                <button
                  disabled={
                    !canCreateGroup ||
                    mutating ||
                    groupNameDraft.trim().length === 0
                  }
                  onClick={createGroup}
                  type="button"
                >
                  {ORG_MANAGER_LABELS.create}
                </button>
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
                    <input
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
                    <button
                      disabled={
                        !canMutateSelectedGroup ||
                        mutating ||
                        !members ||
                        addUserId.trim().length === 0 ||
                        memberUserIds.has(addUserId.trim())
                      }
                      onClick={addUser}
                      type="button"
                    >
                      {ORG_MANAGER_LABELS.add}
                    </button>
                  </div>
                  <div className="org-manager-detail-section">
                    <div className="org-manager-section-heading">
                      {ORG_MANAGER_LABELS.members}
                    </div>
                    <GroupMembers
                      canMutateGroup={canMutateSelectedGroup}
                      members={members?.members ?? []}
                      mutating={mutating}
                      removeMember={removeMember}
                      userId={appData.userId}
                    />
                  </div>
                  <div className="org-manager-detail-section">
                    <div className="org-manager-section-heading">
                      {ORG_MANAGER_LABELS.directContainerLinks}
                    </div>
                    <GroupContainers
                      containers={groupContainers?.containers ?? []}
                    />
                  </div>
                </>
              ) : (
                <div className="org-manager-hint">
                  {ORG_MANAGER_LABELS.selectGroup}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
