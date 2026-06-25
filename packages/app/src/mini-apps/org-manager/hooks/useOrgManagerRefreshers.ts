import type {
  OrganizationContainerGrants,
  OrganizationDataUsage,
  OrganizationDirectory,
  OrganizationGroupContainers,
  OrganizationGroupMembers,
  OrganizationGroupPolicyHistory,
  OrganizationGroupSummary,
  OrganizationPolicyHistory,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import type { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { ORG_MANAGER_LABELS } from "../labels";
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

interface OrgManagerRefreshersParams {
  appData: ReturnType<typeof useTearleadsRuntime>;
  canLoadAuthenticatedOrgData: boolean;
  orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  resetSelectedRosterUser: () => void;
  selectGroup: (groupId: string | null) => void;
  selectedGroupIdRef: { current: string | null };
  selectedUserIdRef: { current: string | null };
  skippedGroupDetailsEffectRef: { current: { groupId: string | null } | null };
  setDataUsage: Dispatch<SetStateAction<OrganizationDataUsage | null>>;
  setDirectory: Dispatch<SetStateAction<OrganizationDirectory | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setGrants: Dispatch<SetStateAction<OrganizationContainerGrants | null>>;
  setGroupContainers: Dispatch<
    SetStateAction<OrganizationGroupContainers | null>
  >;
  setGroupPolicyHistory: Dispatch<
    SetStateAction<OrganizationGroupPolicyHistory | null>
  >;
  setGroups: Dispatch<SetStateAction<ReadonlyArray<OrganizationGroupSummary>>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setLoadingUserDetail: Dispatch<SetStateAction<boolean>>;
  setMemberGroupId: Dispatch<SetStateAction<string | null>>;
  setMembers: Dispatch<SetStateAction<OrganizationGroupMembers | null>>;
  setOrganizationPolicyHistory: Dispatch<
    SetStateAction<OrganizationPolicyHistory | null>
  >;
  setProfileDisplayNamesByUserId: Dispatch<
    SetStateAction<ReadonlyMap<string, string>>
  >;
  setIsCreateGroupDialogOpen: Dispatch<SetStateAction<boolean>>;
  setIsImportUserDialogOpen: Dispatch<SetStateAction<boolean>>;
  setUserDetail: Dispatch<SetStateAction<OrganizationUserDetail | null>>;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Colocates the org-manager data load/refresh callbacks that share setters and ordering.
export function useOrgManagerRefreshers(params: OrgManagerRefreshersParams) {
  const {
    appData,
    canLoadAuthenticatedOrgData,
    orgManagerActions,
    resetSelectedRosterUser,
    selectGroup,
    selectedGroupIdRef,
    selectedUserIdRef,
    skippedGroupDetailsEffectRef,
    setDataUsage,
    setDirectory,
    setError,
    setGrants,
    setGroupContainers,
    setGroupPolicyHistory,
    setGroups,
    setLoading,
    setLoadingUserDetail,
    setMemberGroupId,
    setMembers,
    setOrganizationPolicyHistory,
    setProfileDisplayNamesByUserId,
    setIsCreateGroupDialogOpen,
    setIsImportUserDialogOpen,
    setUserDetail,
  } = params;

  const resetDirectoryState = useCallback(() => {
    setDirectory(null);
    setGroups([]);
    setMemberGroupId(null);
    setMembers(null);
    setGroupContainers(null);
    setGroupPolicyHistory(null);
    setOrganizationPolicyHistory(null);
    setGrants(null);
    setDataUsage(null);
    setProfileDisplayNamesByUserId(new Map());
    setIsCreateGroupDialogOpen(false);
    setIsImportUserDialogOpen(false);
    resetSelectedRosterUser();
    selectGroup(null);
  }, [
    resetSelectedRosterUser,
    selectGroup,
    setDataUsage,
    setDirectory,
    setGrants,
    setGroupContainers,
    setGroupPolicyHistory,
    setGroups,
    setIsCreateGroupDialogOpen,
    setIsImportUserDialogOpen,
    setMemberGroupId,
    setMembers,
    setOrganizationPolicyHistory,
    setProfileDisplayNamesByUserId,
  ]);

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
      setMemberGroupId(nextDirectoryState.memberGroupId);
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
      selectedGroupIdRef,
      setDirectory,
      setError,
      setGroups,
      setMemberGroupId,
      skippedGroupDetailsEffectRef,
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
    [loadDirectoryAndGroups, selectedGroupIdRef, setError, setLoading],
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
      setError,
      setGroupContainers,
      setGroupPolicyHistory,
      setMembers,
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
    [
      canLoadAuthenticatedOrgData,
      orgManagerActions,
      setError,
      setGrants,
      setLoading,
    ],
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
    [
      canLoadAuthenticatedOrgData,
      orgManagerActions,
      setDataUsage,
      setError,
      setLoading,
    ],
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
    [
      canLoadAuthenticatedOrgData,
      orgManagerActions,
      setError,
      setLoading,
      setOrganizationPolicyHistory,
    ],
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
    [
      canLoadAuthenticatedOrgData,
      orgManagerActions,
      setError,
      setLoadingUserDetail,
      setUserDetail,
    ],
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
    selectedUserIdRef,
    setError,
    setLoading,
  ]);

  return {
    loadDirectoryAndGroups,
    refreshDataUsage,
    refreshDirectoryAndGroups,
    refreshGrants,
    refreshOrganizationPolicyHistory,
    refreshOrgManager,
    refreshSelectedGroupDetails,
    refreshSelectedUserDetail,
    resetDirectoryState,
  };
}
