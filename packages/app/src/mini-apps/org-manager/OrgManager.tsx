import type {
  OrganizationDirectoryResponse,
  OrganizationDirectoryUserResponse,
  OrganizationGroupMemberResponse,
  OrganizationGroupMembersResponse,
  OrganizationGroupSummaryResponse,
} from "@tearleads/validators/response";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useAppData } from "../../providers/data/AppDataProvider";
import {
  type OrgManagerUserRecipient,
  useOrgManagerActions,
} from "../../stores/org-manager/OrgManagerProvider";
import {
  getOrgManagerEpochLabel,
  getOrgManagerMemberCountLabel,
  ORG_MANAGER_LABELS,
} from "./labels";
import "./OrgManager.css";

type OrgManagerView = "directory" | "groups";

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

function userRecipient(
  user: OrganizationDirectoryUserResponse,
): OrgManagerUserRecipient {
  return {
    userId: user.userId,
    encapsulationPublicKey: user.encapsulationPublicKey,
    encapsulationKeyFingerprint: user.encapsulationKeyFingerprint,
  };
}

function compactFingerprint(value: string): string {
  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString();
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
              <MiniAppTableText>{formatDate(user.createdAt)}</MiniAppTableText>
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

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The mini-app shell coordinates shared async state across the directory and group panes.
export function OrgManager() {
  const appData = useAppData();
  const orgManagerActions = useOrgManagerActions();
  const [view, setView] = useState<OrgManagerView>("directory");
  const [directory, setDirectory] =
    useState<OrganizationDirectoryResponse | null>(null);
  const [groups, setGroups] = useState<OrganizationGroupSummaryResponse[]>([]);
  const [members, setMembers] =
    useState<OrganizationGroupMembersResponse | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [addUserId, setAddUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      return;
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
        setSelectedGroupId(null);
        setError(ORG_MANAGER_LABELS.failedLoadDirectoryGroups);
        return;
      }

      setDirectory(nextDirectory);
      setGroups(nextGroups.groups);
      setSelectedGroupId((current) => {
        if (
          current &&
          nextGroups.groups.some((group) => group.groupId === current)
        ) {
          return current;
        }

        return nextGroups.groups[0]?.groupId ?? null;
      });
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setLoading(false);
    }
  }, [appData.apiClient, appData.isAuthenticated, appData.organizationId]);

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

  useEffect(() => {
    void refreshDirectoryAndGroups();
  }, [refreshDirectoryAndGroups]);

  useEffect(() => {
    void refreshSelectedGroupMembers(selectedGroupId);
  }, [refreshSelectedGroupMembers, selectedGroupId]);

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
      setSelectedGroupId(createdGroup.groupId);
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
  ]);

  const addUser = useCallback(async () => {
    const targetUser = directory?.users.find(
      (user) => user.userId === addUserId,
    );
    if (
      !directory ||
      !targetUser ||
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
      await orgManagerActions.addUserToGroup(
        selectedGroupId,
        userRecipient(targetUser),
        directory.users.map(userRecipient),
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
          directory.users
            .filter((user) => user.userId !== removedUserId)
            .map(userRecipient),
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
      orgManagerActions,
      refreshDirectoryAndGroups,
      refreshSelectedGroupMembers,
      selectedGroupId,
    ],
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
      <aside className="org-manager-sidebar">
        <MiniAppRowButton
          className="org-manager-nav"
          onClick={() => setView("directory")}
          selected={view === "directory"}
        >
          {ORG_MANAGER_LABELS.directory}
        </MiniAppRowButton>
        <MiniAppRowButton
          className="org-manager-nav"
          onClick={() => setView("groups")}
          selected={view === "groups"}
        >
          {ORG_MANAGER_LABELS.groups}
        </MiniAppRowButton>
        <MiniAppRowButton
          className="org-manager-nav"
          disabled={loading || mutating}
          onClick={refreshDirectoryAndGroups}
        >
          {ORG_MANAGER_LABELS.refresh}
        </MiniAppRowButton>
      </aside>
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
                setSelectedGroupId={setSelectedGroupId}
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
                    <select
                      disabled={
                        !canMutateSelectedGroup ||
                        mutating ||
                        addableUsers.length === 0
                      }
                      onChange={(event) => setAddUserId(event.target.value)}
                      value={addUserId}
                    >
                      <option value="">{ORG_MANAGER_LABELS.addUser}</option>
                      {addableUsers.map((user) => (
                        <option key={user.userId} value={user.userId}>
                          {user.isSelf
                            ? ORG_MANAGER_LABELS.self
                            : compactFingerprint(user.userId)}
                        </option>
                      ))}
                    </select>
                    <button
                      disabled={
                        !canMutateSelectedGroup || mutating || addUserId === ""
                      }
                      onClick={addUser}
                      type="button"
                    >
                      {ORG_MANAGER_LABELS.add}
                    </button>
                  </div>
                  <GroupMembers
                    canMutateGroup={canMutateSelectedGroup}
                    members={members?.members ?? []}
                    mutating={mutating}
                    removeMember={removeMember}
                    userId={appData.userId}
                  />
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
