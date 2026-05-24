import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAppData } from "../../../providers/data/AppDataProvider";
import {
  type OrgManagerContainerGrant,
  type OrgManagerContainerGrants,
  type OrgManagerDataUsage,
  type OrgManagerDirectory,
  type OrgManagerDirectoryUser,
  type OrgManagerGroupContainers,
  type OrgManagerGroupMembers,
  type OrgManagerGroupPolicyHistory,
  type OrgManagerGroupSummary,
  type OrgManagerPolicyHistory,
  type OrgManagerUserDetail,
  useOrgManagerActions,
} from "../../../stores/org-manager/OrgManagerProvider";
import { useMiniAppMessage } from "../../bus";
import {
  removeRevokedGrantFromGrantState,
  removeRevokedGrantFromGroupContainers,
  removeRevokedGrantFromUserDetail,
} from "../grantState";
import { ORG_MANAGER_LABELS } from "../labels";
import { useOrgManagerSidebarPanel } from "../OrgManagerSidebar";
import { canCurrentUserMutateSelectedGroup } from "../permissions";
import { currentGroupUserRecipients, userRecipient } from "../recipients";
import {
  clearErrorIfRequested,
  type DataUsageRefreshOptions,
  type DirectoryRefreshOptions,
  type DirectoryRefreshResult,
  directoryLoadOptions,
  type GrantsRefreshOptions,
  type GroupDetailsRefreshOptions,
  getRefreshBehavior,
  type RefreshBehaviorOptions,
  setLoadingIfManaged,
  setUnknownError,
} from "../refresh";
import { resolveOrgManagerSelectedGroupId } from "../routes";
import { useOrgManagerRoute } from "./useOrgManagerRoute";

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The hook keeps related async refresh and mutation ordering in one place.
export function useOrgManagerModel() {
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
  const [profileDocumentIdDraft, setProfileDocumentIdDraft] = useState("");
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
  const selectedGroupIsMembersGroup =
    selectedGroup?.name === ORG_MANAGER_LABELS.members;
  const canCreateGroup = directory?.currentUser.isOrgAdmin ?? false;
  const canMutateSelectedGroup = canCurrentUserMutateSelectedGroup({
    directory,
    members,
    userId: appData.userId,
  });
  const selectedRosterUser = useMemo(
    () =>
      userDetail?.user ??
      directory?.users.find((user) => user.userId === selectedUserId) ??
      null,
    [directory?.users, selectedUserId, userDetail?.user],
  );
  const canUpdateSelectedRosterEntry = Boolean(
    selectedRosterUser &&
      (directory?.currentUser.isOrgAdmin ||
        selectedRosterUser.userId === appData.userId),
  );
  const selectedRosterProfileDocumentId =
    selectedRosterUser?.profileDocumentId ?? null;
  const profileDocumentIdDraftChanged =
    (profileDocumentIdDraft.trim() || null) !== selectedRosterProfileDocumentId;

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
      directory?.users.filter(
        (user) =>
          (user.status === "active" || selectedGroupIsMembersGroup) &&
          !memberUserIds.has(user.userId),
      ) ?? [],
    [directory, memberUserIds, selectedGroupIsMembersGroup],
  );
  const canRevokeGrants = directory?.currentUser.isOrgAdmin ?? false;

  const selectUser = useCallback((userId: string | null) => {
    selectedUserIdRef.current = userId;
    setSelectedUserIdState(userId);
    setUserDetail(null);
    setProfileDocumentIdDraft("");
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
    setProfileDocumentIdDraft(selectedRosterUser?.profileDocumentId ?? "");
  }, [selectedRosterUser?.profileDocumentId, selectedRosterUser?.userId]);

  useEffect(() => {
    void refreshSelectedUserDetail(selectedUserId);
  }, [refreshSelectedUserDetail, selectedUserId]);

  const updateRosterUserState = useCallback(
    (updatedUser: OrgManagerDirectoryUser) => {
      setDirectory((currentDirectory) => {
        if (!currentDirectory) {
          return currentDirectory;
        }

        return {
          ...currentDirectory,
          users: currentDirectory.users.map((user) =>
            user.userId === updatedUser.userId ? updatedUser : user,
          ),
        };
      });
      setUserDetail((currentUserDetail) =>
        currentUserDetail?.user.userId === updatedUser.userId
          ? { ...currentUserDetail, user: updatedUser }
          : currentUserDetail,
      );
    },
    [],
  );

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
    if (directoryUser?.status === "disabled" && !selectedGroupIsMembersGroup) {
      setError(ORG_MANAGER_LABELS.userNotFound);
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
    selectedGroupIsMembersGroup,
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

  const updateSelectedRosterProfileDocument = useCallback(async () => {
    const targetUserId = selectedUserIdRef.current;
    const nextProfileDocumentId = profileDocumentIdDraft.trim() || null;
    if (
      !targetUserId ||
      !canLoadAuthenticatedOrgData ||
      !canUpdateSelectedRosterEntry ||
      nextProfileDocumentId === selectedRosterProfileDocumentId
    ) {
      return;
    }

    setMutating(true);
    setError(null);
    try {
      const updatedUser = await orgManagerActions.updateRosterEntry(
        targetUserId,
        nextProfileDocumentId,
      );
      if (!updatedUser) {
        setError(ORG_MANAGER_LABELS.failedUpdateRosterEntry);
        return;
      }

      updateRosterUserState(updatedUser);
      setProfileDocumentIdDraft(updatedUser.profileDocumentId ?? "");
    } catch (nextError) {
      setUnknownError(setError, nextError);
    } finally {
      setMutating(false);
    }
  }, [
    canLoadAuthenticatedOrgData,
    canUpdateSelectedRosterEntry,
    orgManagerActions,
    profileDocumentIdDraft,
    selectedRosterProfileDocumentId,
    updateRosterUserState,
  ]);

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

  return {
    addUser,
    addUserId,
    addUserListId,
    addableUsers,
    canCreateGroup,
    canLoadAuthenticatedOrgData,
    canMutateSelectedGroup,
    canRevokeGrants,
    canUpdateSelectedRosterEntry,
    createGroup,
    dataUsage,
    directory,
    error,
    grants,
    groupContainers,
    groupNameDraft,
    groupPolicyHistory,
    groups,
    isAuthenticated: appData.isAuthenticated,
    loading,
    loadingUserDetail,
    members,
    memberUserIds,
    mutating,
    openGroupRoute,
    organizationId: appData.organizationId,
    organizationPolicyHistory,
    profileDocumentIdDraft,
    profileDocumentIdDraftChanged,
    refreshOrgManager,
    removeMember,
    revokeGrant,
    selectedGroup,
    selectedGroupId,
    selectedUserId,
    selectGroup,
    selectUser,
    setAddUserId,
    setGroupNameDraft,
    setProfileDocumentIdDraft,
    updateSelectedRosterProfileDocument,
    userDetail,
    userId: appData.userId,
    view,
  };
}

export type OrgManagerModel = ReturnType<typeof useOrgManagerModel>;
