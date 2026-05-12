import type {
  OrganizationDirectoryResponse,
  OrganizationDirectoryUserResponse,
  OrganizationGroupMemberResponse,
  OrganizationGroupMembersResponse,
  OrganizationGroupSummaryResponse,
} from "@tearleads/validators/response";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppData } from "../../providers/data/AppDataProvider";
import {
  type OrgManagerUserRecipient,
  useOrgManagerActions,
} from "../../stores/org-manager/OrgManagerProvider";
import "./OrgManager.css";

type OrgManagerView = "directory" | "groups";

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

function DirectoryTable({
  directory,
}: {
  directory: OrganizationDirectoryResponse | null;
}) {
  if (!directory) {
    return <div className="org-manager-hint">Loading directory...</div>;
  }

  if (directory.users.length === 0) {
    return <div className="org-manager-hint">No direct users.</div>;
  }

  return (
    <div className="org-manager-table">
      <div className="org-manager-table-row org-manager-table-row--header">
        <span>User</span>
        <span>Role</span>
        <span>Signing key</span>
        <span>Joined</span>
      </div>
      {directory.users.map((user) => (
        <div className="org-manager-table-row" key={user.userId}>
          <span title={user.userId}>
            {user.isSelf ? "You" : compactFingerprint(user.userId)}
          </span>
          <span>{user.role}</span>
          <span title={user.signingKeyFingerprint}>
            {compactFingerprint(user.signingKeyFingerprint)}
          </span>
          <span>{formatDate(user.createdAt)}</span>
        </div>
      ))}
    </div>
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
    return <div className="org-manager-hint">No groups.</div>;
  }

  return (
    <div className="org-manager-group-list">
      {groups.map((group) => (
        <button
          className={`org-manager-group-button${
            selectedGroupId === group.groupId
              ? " org-manager-group-button--selected"
              : ""
          }`}
          key={group.groupId}
          onClick={() => setSelectedGroupId(group.groupId)}
          type="button"
        >
          <strong>{group.name}</strong>
          <span>
            {group.currentState
              ? `${group.currentState.memberCount} member${
                  group.currentState.memberCount === 1 ? "" : "s"
                }`
              : "Uninitialized"}
          </span>
        </button>
      ))}
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
    return <div className="org-manager-hint">No group members.</div>;
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
          <div
            className="org-manager-member-row"
            key={member.memberPrincipalId}
          >
            <div>
              <strong title={member.memberPrincipalId}>
                {member.userId
                  ? compactFingerprint(member.userId)
                  : (member.groupName ??
                    compactFingerprint(member.memberPrincipalId))}
              </strong>
              <span>{member.role}</span>
            </div>
            {member.memberPrincipalType === "user" && (
              <button
                disabled={!canRemove || mutating}
                onClick={() => removeMember(member.memberPrincipalId)}
                type="button"
              >
                Remove
              </button>
            )}
          </div>
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
  const selfDirectoryUser =
    directory?.users.find((user) => user.userId === appData.userId) ?? null;
  const canCreateGroup = selfDirectoryUser?.role === "admin";
  const canMutateSelectedGroup =
    members?.members.some(
      (member) =>
        member.memberPrincipalType === "user" &&
        member.memberPrincipalId === appData.userId &&
        member.role === "admin",
    ) ?? false;

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

      setDirectory(nextDirectory);
      setGroups(nextGroups?.groups ?? []);
      setSelectedGroupId((current) => {
        if (
          current &&
          nextGroups?.groups.some((group) => group.groupId === current)
        ) {
          return current;
        }

        return nextGroups?.groups[0]?.groupId ?? null;
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

      try {
        const nextMembers =
          await appData.apiClient.listOrganizationGroupMembers(
            appData.organizationId,
            groupId,
          );
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
          Authenticate to manage an organization.
        </div>
      </div>
    );
  }

  return (
    <div className="org-manager">
      <aside className="org-manager-sidebar">
        <button
          className={view === "directory" ? "org-manager-nav--selected" : ""}
          onClick={() => setView("directory")}
          type="button"
        >
          Directory
        </button>
        <button
          className={view === "groups" ? "org-manager-nav--selected" : ""}
          onClick={() => setView("groups")}
          type="button"
        >
          Groups
        </button>
        <button
          disabled={loading || mutating}
          onClick={refreshDirectoryAndGroups}
          type="button"
        >
          Refresh
        </button>
      </aside>
      <main className="org-manager-main">
        {error && <div className="org-manager-error">{error}</div>}
        {view === "directory" ? (
          <DirectoryTable directory={directory} />
        ) : (
          <div className="org-manager-groups">
            <section className="org-manager-panel">
              <div className="org-manager-create-group">
                <input
                  disabled={!canCreateGroup || mutating}
                  onChange={(event) => setGroupNameDraft(event.target.value)}
                  placeholder="Group name"
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
                  Create
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
                        ? `Epoch ${selectedGroup.currentState.keyEpoch}`
                        : "No policy"}
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
                      <option value="">Add user</option>
                      {addableUsers.map((user) => (
                        <option key={user.userId} value={user.userId}>
                          {user.isSelf
                            ? "You"
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
                      Add
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
                <div className="org-manager-hint">Select a group.</div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
