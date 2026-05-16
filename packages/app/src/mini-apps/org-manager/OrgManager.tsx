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
  type OrgManagerContainerGrant,
  type OrgManagerContainerGrants,
  type OrgManagerDirectory,
  type OrgManagerDirectoryUser,
  type OrgManagerGroupContainer,
  type OrgManagerGroupContainers,
  type OrgManagerGroupMember,
  type OrgManagerGroupMembers,
  type OrgManagerGroupSummary,
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
] satisfies ReadonlyArray<MiniAppTableColumn>;

const ACCESS_LEVEL_LABELS = {
  admin: ORG_MANAGER_LABELS.accessAdmin,
  read: ORG_MANAGER_LABELS.accessRead,
  write: ORG_MANAGER_LABELS.accessWrite,
} satisfies Record<OrgManagerGroupContainer["accessLevel"], string>;

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
}: {
  directory: OrgManagerDirectory | null;
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
  groups: ReadonlyArray<OrgManagerGroupSummary>;
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
  members: ReadonlyArray<OrgManagerGroupMember>;
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
  containers: ReadonlyArray<OrgManagerGroupContainer>;
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

function GrantTable({
  emptyLabel,
  grants,
  label,
}: {
  emptyLabel: string;
  grants: ReadonlyArray<OrgManagerContainerGrant>;
  label: string;
}) {
  if (grants.length === 0) {
    return <div className="org-manager-hint">{emptyLabel}</div>;
  }

  return (
    <MiniAppTableFrame>
      <MiniAppTable aria-label={label} columns={GRANT_TABLE_COLUMNS}>
        {grants.map((grant) => (
          <MiniAppTableRow
            key={`${grant.subjectType}:${grant.subjectId}:${grant.containerId}:${grant.accessLevel}`}
          >
            <MiniAppTableCell>
              <MiniAppTableText title={grant.subjectId}>
                {getGrantPrincipalLabel(grant)}
              </MiniAppTableText>
            </MiniAppTableCell>
            <MiniAppTableCell>
              <MiniAppTableText title={grant.containerId}>
                {compactFingerprint(grant.containerId)}
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
          </MiniAppTableRow>
        ))}
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}

function GrantsView({
  grants,
  loading,
}: {
  grants: OrgManagerContainerGrants | null;
  loading: boolean;
}) {
  if (!grants) {
    return (
      <div className="org-manager-hint">
        {loading
          ? ORG_MANAGER_LABELS.loadingGrants
          : ORG_MANAGER_LABELS.grantsUnavailable}
      </div>
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
    <div className="org-manager-grants">
      <section className="org-manager-detail-section">
        <div className="org-manager-section-heading">
          {ORG_MANAGER_LABELS.groupContainerLinks}
        </div>
        <GrantTable
          emptyLabel={ORG_MANAGER_LABELS.noGroupContainerLinks}
          grants={groupGrants}
          label={ORG_MANAGER_LABELS.groupContainerLinks}
        />
      </section>
      <section className="org-manager-detail-section">
        <div className="org-manager-section-heading">
          {ORG_MANAGER_LABELS.userContainerLinks}
        </div>
        <GrantTable
          emptyLabel={ORG_MANAGER_LABELS.noUserContainerLinks}
          grants={userGrants}
          label={ORG_MANAGER_LABELS.userContainerLinks}
        />
      </section>
      <section className="org-manager-detail-section">
        <div className="org-manager-section-heading">
          {ORG_MANAGER_LABELS.organizationContainerLinks}
        </div>
        <GrantTable
          emptyLabel={ORG_MANAGER_LABELS.noOrganizationContainerLinks}
          grants={organizationGrants}
          label={ORG_MANAGER_LABELS.organizationContainerLinks}
        />
      </section>
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The mini-app shell coordinates shared async state across the directory and group panes.
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The mini-app shell coordinates shared async state across the directory and group panes.
export function OrgManager() {
  const appData = useAppData();
  const orgManagerActions = useOrgManagerActions();
  const addUserListId = useId();
  const [view, setView] = useState<OrgManagerView>("directory");
  const [directory, setDirectory] = useState<OrgManagerDirectory | null>(null);
  const [groups, setGroups] = useState<ReadonlyArray<OrgManagerGroupSummary>>(
    [],
  );
  const [members, setMembers] = useState<OrgManagerGroupMembers | null>(null);
  const [groupContainers, setGroupContainers] =
    useState<OrgManagerGroupContainers | null>(null);
  const [grants, setGrants] = useState<OrgManagerContainerGrants | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [addUserId, setAddUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedGroupIdRef = useRef(selectedGroupId);
  const skippedGroupDetailsEffectRef = useRef<{
    groupId: string | null;
  } | null>(null);

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

  const resetDirectoryState = useCallback(() => {
    setDirectory(null);
    setGroups([]);
    setMembers(null);
    setGroupContainers(null);
    setGrants(null);
    selectGroup(null);
  }, [selectGroup]);

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
      const nextSelectedGroupId =
        currentSelectedGroupId &&
        nextDirectoryState.groups.some(
          (group) => group.groupId === currentSelectedGroupId,
        )
          ? currentSelectedGroupId
          : (nextDirectoryState.groups[0]?.groupId ?? null);
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
      const shouldClearError = options.clearError ?? true;
      const shouldManageLoading = options.manageLoading ?? true;

      if (shouldManageLoading) {
        setLoading(true);
      }
      if (shouldClearError) {
        setError(null);
      }

      try {
        return await loadDirectoryAndGroups(
          options.skipNextGroupDetailsEffect === undefined
            ? {}
            : {
                skipNextGroupDetailsEffect: options.skipNextGroupDetailsEffect,
              },
        );
      } catch (nextError) {
        setError(
          nextError instanceof Error ? nextError.message : String(nextError),
        );
        return { didLoad: false, groupId: selectedGroupIdRef.current };
      } finally {
        if (shouldManageLoading) {
          setLoading(false);
        }
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
        return;
      }

      if (shouldClearError) {
        setError(null);
      }
      try {
        const { members: nextMembers, containers: nextContainers } =
          await orgManagerActions.loadGroupDetails(groupId);
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

        if (errors.length > 0) {
          setError(errors.join(" "));
        }
      } catch (nextError) {
        setMembers(null);
        setGroupContainers(null);
        setError(
          nextError instanceof Error ? nextError.message : String(nextError),
        );
      }
    },
    [appData.isAuthenticated, appData.organizationId, orgManagerActions],
  );

  const refreshGrants = useCallback(
    async (options: GrantsRefreshOptions = {}) => {
      const shouldClearError = options.clearError ?? true;
      const shouldManageLoading = options.manageLoading ?? true;
      if (!appData.organizationId || !appData.isAuthenticated) {
        setGrants(null);
        return;
      }

      if (shouldManageLoading) {
        setLoading(true);
      }
      if (shouldClearError) {
        setError(null);
      }

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
        setError(
          nextError instanceof Error ? nextError.message : String(nextError),
        );
      } finally {
        if (shouldManageLoading) {
          setLoading(false);
        }
      }
    },
    [appData.isAuthenticated, appData.organizationId, orgManagerActions],
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
      ]);
      if (refreshedDirectory.didLoad) {
        await refreshSelectedGroupDetails(refreshedDirectory.groupId, {
          clearError: false,
        });
      }
    } finally {
      setLoading(false);
    }
  }, [refreshDirectoryAndGroups, refreshGrants, refreshSelectedGroupDetails]);

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
      const refreshedDirectory = await refreshDirectoryAndGroups({
        skipNextGroupDetailsEffect: true,
      });
      if (refreshedDirectory.didLoad) {
        await refreshSelectedGroupDetails(refreshedDirectory.groupId);
      }
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
    refreshSelectedGroupDetails,
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
      refreshSelectedGroupDetails,
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
        ) : view === "grants" ? (
          <GrantsView grants={grants} loading={loading} />
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
