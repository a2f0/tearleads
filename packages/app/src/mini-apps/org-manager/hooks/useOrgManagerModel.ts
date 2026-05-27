import type {
  OrganizationContainerGrant,
  OrganizationContainerGrants,
  OrganizationDataUsage,
  OrganizationDirectory,
  OrganizationDirectoryUser,
  OrganizationGroupContainers,
  OrganizationGroupMembers,
  OrganizationGroupPolicyHistory,
  OrganizationGroupSummary,
  OrganizationPolicyHistory,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
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
import {
  type OrgManagerView,
  resolveOrgManagerSelectedGroupId,
} from "../routes";
import { useOrgManagerRoute } from "./useOrgManagerRoute";

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The hook keeps related async refresh and mutation ordering in one place.
export function useOrgManagerModel() {
  const appData = useTearleadsRuntime();
  const orgManagerActions = useOrgManagerActions();
  const addUserListId = useId();
  const [directory, setDirectory] = useState<OrganizationDirectory | null>(
    null,
  );
  const [groups, setGroups] = useState<ReadonlyArray<OrganizationGroupSummary>>(
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
  const [members, setMembers] = useState<OrganizationGroupMembers | null>(null);
  const [groupContainers, setGroupContainers] =
    useState<OrganizationGroupContainers | null>(null);
  const [groupPolicyHistory, setGroupPolicyHistory] =
    useState<OrganizationGroupPolicyHistory | null>(null);
  const [organizationPolicyHistory, setOrganizationPolicyHistory] =
    useState<OrganizationPolicyHistory | null>(null);
  const [grants, setGrants] = useState<OrganizationContainerGrants | null>(
    null,
  );
  const [dataUsage, setDataUsage] = useState<OrganizationDataUsage | null>(
    null,
  );
  const [selectedUserId, setSelectedUserIdState] = useState<string | null>(
    null,
  );
  const [userDetail, setUserDetail] = useState<OrganizationUserDetail | null>(
    null,
  );
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [isCreateGroupDialogOpen, setIsCreateGroupDialogOpen] = useState(false);
  const [addUserId, setAddUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingUserDetail, setLoadingUserDetail] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skippedGroupDetailsEffectRef = useRef<{
    groupId: string | null;
  } | null>(null);
  const profileDocumentCreationKeysRef = useRef<Set<string>>(new Set());
  const selectedUserIdRef = useRef<string | null>(null);
  const canLoadAuthenticatedOrgData = Boolean(
    appData.auth.organizationId && appData.auth.isAuthenticated,
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
    userId: appData.auth.userId,
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
        selectedRosterUser.userId === appData.auth.userId),
  );

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

  const openCreateGroupDialog = useCallback(() => {
    if (!canCreateGroup) {
      return;
    }

    setError(null);
    setGroupNameDraft("");
    selectGroup(null);
    setView("groups");
    setIsCreateGroupDialogOpen(true);
  }, [canCreateGroup, selectGroup, setView]);

  const closeCreateGroupDialog = useCallback(() => {
    if (mutating) {
      return;
    }

    setError(null);
    setGroupNameDraft("");
    setIsCreateGroupDialogOpen(false);
  }, [mutating]);

  const selectUser = useCallback((userId: string | null) => {
    selectedUserIdRef.current = userId;
    setSelectedUserIdState(userId);
    setUserDetail(null);
  }, []);

  const setOrgManagerView = useCallback(
    (nextView: OrgManagerView) => {
      if (nextView === "directory") {
        selectUser(null);
      }
      if (nextView === "groups") {
        selectGroup(null);
      }
      setView(nextView);
    },
    [selectGroup, selectUser, setView],
  );

  const resetDirectoryState = useCallback(() => {
    setDirectory(null);
    setGroups([]);
    setMembers(null);
    setGroupContainers(null);
    setGroupPolicyHistory(null);
    setOrganizationPolicyHistory(null);
    setGrants(null);
    setDataUsage(null);
    setIsCreateGroupDialogOpen(false);
    selectUser(null);
    selectGroup(null);
  }, [selectGroup, selectUser]);

  const loadDirectoryAndGroups = useCallback(
    async (
      options: Pick<DirectoryRefreshOptions, "skipNextGroupDetailsEffect"> = {},
    ): Promise<DirectoryRefreshResult> => {
      if (!appData.auth.organizationId || !appData.auth.isAuthenticated) {
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
      appData.auth.isAuthenticated,
      appData.auth.organizationId,
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
      if (
        !appData.auth.organizationId ||
        !groupId ||
        !appData.auth.isAuthenticated
      ) {
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
    [
      appData.auth.isAuthenticated,
      appData.auth.organizationId,
      orgManagerActions,
    ],
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

  const updateRosterUserState = useCallback(
    (updatedUser: OrganizationDirectoryUser) => {
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

  useEffect(() => {
    if (
      !selectedRosterUser ||
      selectedRosterUser.profileDocumentId ||
      !canLoadAuthenticatedOrgData ||
      !canUpdateSelectedRosterEntry ||
      !appData.auth.organizationId
    ) {
      return;
    }

    const profileDocumentCreationKey = `${appData.auth.organizationId}:${selectedRosterUser.userId}`;
    if (
      profileDocumentCreationKeysRef.current.has(profileDocumentCreationKey)
    ) {
      return;
    }

    profileDocumentCreationKeysRef.current.add(profileDocumentCreationKey);
    setMutating(true);
    setError(null);

    void orgManagerActions
      .ensureRosterProfileDocument(selectedRosterUser)
      .then((updatedUser) => {
        if (!updatedUser) {
          if (selectedUserIdRef.current === selectedRosterUser.userId) {
            setError(ORG_MANAGER_LABELS.failedCreateProfileDocument);
          }
          return;
        }

        updateRosterUserState(updatedUser);
      })
      .catch((nextError: unknown) => {
        if (selectedUserIdRef.current === selectedRosterUser.userId) {
          setUnknownError(setError, nextError);
        }
      })
      .finally(() => {
        profileDocumentCreationKeysRef.current.delete(
          profileDocumentCreationKey,
        );
        if (profileDocumentCreationKeysRef.current.size === 0) {
          setMutating(false);
        }
      });
  }, [
    appData.auth.organizationId,
    canLoadAuthenticatedOrgData,
    canUpdateSelectedRosterEntry,
    orgManagerActions,
    selectedRosterUser,
    updateRosterUserState,
  ]);

  const createGroup = useCallback(async () => {
    if (
      !appData.auth.organizationId ||
      !appData.auth.userId ||
      !appData.crypto.signingFingerprint ||
      !appData.crypto.signingKeyPair ||
      !appData.crypto.encapsulationKeyPair ||
      groupNameDraft.trim().length === 0
    ) {
      return;
    }
    setMutating(true);
    setError(null);
    try {
      const createdGroup = await orgManagerActions.createGroup(
        groupNameDraft.trim(),
      );
      setGroupNameDraft("");
      setIsCreateGroupDialogOpen(false);
      await refreshDirectoryAndGroups();
      openGroupRoute(createdGroup.groupId);
    } catch (nextError) {
      setUnknownError(setError, nextError);
    } finally {
      setMutating(false);
    }
  }, [
    appData.auth.organizationId,
    appData.auth.userId,
    appData.crypto.encapsulationKeyPair,
    appData.crypto.signingFingerprint,
    appData.crypto.signingKeyPair,
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
      !appData.auth.userId ||
      !appData.crypto.signingFingerprint ||
      !appData.crypto.signingKeyPair ||
      !appData.crypto.encapsulationKeyPair
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
    appData.auth.userId,
    appData.crypto.encapsulationKeyPair,
    appData.crypto.signingFingerprint,
    appData.crypto.signingKeyPair,
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
        !appData.auth.userId ||
        !appData.crypto.signingFingerprint ||
        !appData.crypto.signingKeyPair ||
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
      appData.auth.userId,
      appData.crypto.signingFingerprint,
      appData.crypto.signingKeyPair,
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
    async (grant: OrganizationContainerGrant) => {
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
    enabled: Boolean(
      appData.auth.organizationId && appData.auth.isAuthenticated,
    ),
    setView: setOrgManagerView,
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
    closeCreateGroupDialog,
    createGroup,
    dataUsage,
    directory,
    error,
    grants,
    groupContainers,
    groupNameDraft,
    groupPolicyHistory,
    groups,
    isCreateGroupDialogOpen,
    isAuthenticated: appData.auth.isAuthenticated,
    loading,
    loadingUserDetail,
    members,
    memberUserIds,
    mutating,
    openGroupRoute,
    openCreateGroupDialog,
    organizationId: appData.auth.organizationId,
    organizationPolicyHistory,
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
    userDetail,
    userId: appData.auth.userId,
    view,
  };
}

export type OrgManagerModel = ReturnType<typeof useOrgManagerModel>;
