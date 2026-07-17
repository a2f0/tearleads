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
import type { useOrgManagerRequestGuard } from "./useOrgManagerRequestGuard";
import { useOrgManagerUserDetailRefresher } from "./useOrgManagerUserDetailRefresher";

type BeginRequest = ReturnType<typeof useOrgManagerRequestGuard>;

interface OrgManagerRefreshersParams {
  appData: ReturnType<typeof useTearleadsRuntime>;
  beginRequest: BeginRequest;
  canLoadAuthenticatedOrgData: boolean;
  orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  resetSelectedRosterUser: () => void;
  selectGroup: (groupId: string | null) => void;
  selectedGroupIdRef: { current: string | null };
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
    beginRequest,
    canLoadAuthenticatedOrgData,
    orgManagerActions,
    resetSelectedRosterUser,
    selectGroup,
    selectedGroupIdRef,
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
    setProfileDisplayNamesByUserId(new Map());
    setIsCreateGroupDialogOpen(false);
    setIsImportUserDialogOpen(false);
    resetSelectedRosterUser();
    selectGroup(null);
  }, [
    resetSelectedRosterUser,
    selectGroup,
    setDirectory,
    setGroupContainers,
    setGroupPolicyHistory,
    setGroups,
    setIsCreateGroupDialogOpen,
    setIsImportUserDialogOpen,
    setMemberGroupId,
    setMembers,
    setProfileDisplayNamesByUserId,
  ]);

  const loadDirectoryAndGroups = useCallback(
    async (
      isCurrentRequest: () => boolean,
      options: Pick<DirectoryRefreshOptions, "skipNextGroupDetailsEffect"> = {},
    ): Promise<DirectoryRefreshResult> => {
      if (!appData.auth.organizationId || !appData.auth.isAuthenticated) {
        if (isCurrentRequest()) {
          resetDirectoryState();
        }
        return { didLoad: false, groupId: null };
      }

      const applyDirectoryAndGroups = (
        nextDirectoryState: NonNullable<
          Awaited<ReturnType<typeof orgManagerActions.loadDirectoryAndGroups>>
        >,
      ): DirectoryRefreshResult => {
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
          skippedGroupDetailsEffectRef.current = {
            groupId: nextSelectedGroupId,
          };
        }
        selectGroup(nextSelectedGroupId);
        return {
          didLoad: true,
          directory: nextDirectoryState.directory,
          groupId: nextSelectedGroupId,
          groups: nextDirectoryState.groups,
        };
      };

      const localDirectoryState =
        await orgManagerActions.loadLocalDirectoryAndGroups();
      if (!isCurrentRequest()) {
        return { didLoad: false, groupId: null };
      }
      if (localDirectoryState) {
        applyDirectoryAndGroups(localDirectoryState);
      }

      const nextDirectoryState =
        await orgManagerActions.loadDirectoryAndGroups();
      if (!isCurrentRequest()) {
        return { didLoad: false, groupId: null };
      }
      if (nextDirectoryState) {
        return applyDirectoryAndGroups(nextDirectoryState);
      }

      resetDirectoryState();
      setError(ORG_MANAGER_LABELS.failedLoadDirectoryGroups);
      return { didLoad: false, groupId: null };
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
      const isCurrentRequest = beginRequest("directory");
      const { shouldClearError, shouldManageLoading } =
        getRefreshBehavior(options);
      setLoadingIfManaged(shouldManageLoading, setLoading, true);
      clearErrorIfRequested(shouldClearError, setError);

      try {
        return await loadDirectoryAndGroups(
          isCurrentRequest,
          directoryLoadOptions(options),
        );
      } catch (nextError) {
        if (isCurrentRequest()) {
          setUnknownError(setError, nextError);
        }
        return { didLoad: false, groupId: selectedGroupIdRef.current };
      } finally {
        if (isCurrentRequest()) {
          setLoadingIfManaged(shouldManageLoading, setLoading, false);
        }
      }
    },
    [
      beginRequest,
      loadDirectoryAndGroups,
      selectedGroupIdRef,
      setError,
      setLoading,
    ],
  );

  const refreshSelectedGroupDetails = useCallback(
    async (
      groupId: string | null,
      options: GroupDetailsRefreshOptions = {},
    ) => {
      const isCurrentRequest = beginRequest("groupDetails");
      const shouldClearError = options.clearError ?? true;
      if (
        !appData.auth.organizationId ||
        !groupId ||
        !appData.auth.isAuthenticated
      ) {
        if (isCurrentRequest()) {
          setMembers(null);
          setGroupContainers(null);
          setGroupPolicyHistory(null);
        }
        return;
      }

      if (shouldClearError) {
        setError(null);
      }
      try {
        const nextDetails = await orgManagerActions.loadGroupDetails(groupId);
        if (!isCurrentRequest()) {
          return;
        }
        const {
          containers: nextContainers,
          members: nextMembers,
          policyHistory: nextPolicyHistory,
        } = nextDetails;
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
        if (isCurrentRequest()) {
          setMembers(null);
          setGroupContainers(null);
          setGroupPolicyHistory(null);
          setUnknownError(setError, nextError);
        }
      }
    },
    [
      appData.auth.isAuthenticated,
      appData.auth.organizationId,
      beginRequest,
      orgManagerActions,
      setError,
      setGroupContainers,
      setGroupPolicyHistory,
      setMembers,
    ],
  );

  const refreshGrants = useCallback(
    async (options: GrantsRefreshOptions = {}) => {
      const isCurrentRequest = beginRequest("grants");
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
        if (!isCurrentRequest()) {
          return;
        }
        if (nextGrants === null) {
          setGrants(null);
          setError(ORG_MANAGER_LABELS.failedLoadGrants);
          return;
        }

        setGrants(nextGrants);
      } catch (nextError) {
        if (isCurrentRequest()) {
          setGrants(null);
          setUnknownError(setError, nextError);
        }
      } finally {
        if (isCurrentRequest()) {
          setLoadingIfManaged(shouldManageLoading, setLoading, false);
        }
      }
    },
    [
      canLoadAuthenticatedOrgData,
      beginRequest,
      orgManagerActions,
      setError,
      setGrants,
      setLoading,
    ],
  );

  const refreshDataUsage = useCallback(
    async (options: DataUsageRefreshOptions = {}) => {
      const isCurrentRequest = beginRequest("dataUsage");
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
        if (!isCurrentRequest()) {
          return;
        }
        if (nextUsage === null) {
          setDataUsage(null);
          setError(ORG_MANAGER_LABELS.failedLoadDataUsage);
          return;
        }

        setDataUsage(nextUsage);
      } catch (nextError) {
        if (isCurrentRequest()) {
          setDataUsage(null);
          setUnknownError(setError, nextError);
        }
      } finally {
        if (isCurrentRequest()) {
          setLoadingIfManaged(shouldManageLoading, setLoading, false);
        }
      }
    },
    [
      canLoadAuthenticatedOrgData,
      beginRequest,
      orgManagerActions,
      setDataUsage,
      setError,
      setLoading,
    ],
  );

  const refreshOrganizationPolicyHistory = useCallback(
    async (options: RefreshBehaviorOptions = {}) => {
      const isCurrentRequest = beginRequest("organizationPolicy");
      const { shouldClearError, shouldManageLoading } =
        getRefreshBehavior(options);
      if (!canLoadAuthenticatedOrgData) {
        setOrganizationPolicyHistory(null);
        return;
      }

      setLoadingIfManaged(shouldManageLoading, setLoading, true);
      clearErrorIfRequested(shouldClearError, setError);

      try {
        const nextPolicyHistory = await orgManagerActions.loadPolicyHistory();
        if (isCurrentRequest()) {
          setOrganizationPolicyHistory(nextPolicyHistory);
        }
      } catch (nextError) {
        if (isCurrentRequest()) {
          setOrganizationPolicyHistory(null);
          setUnknownError(setError, nextError);
        }
      } finally {
        if (isCurrentRequest()) {
          setLoadingIfManaged(shouldManageLoading, setLoading, false);
        }
      }
    },
    [
      canLoadAuthenticatedOrgData,
      beginRequest,
      orgManagerActions,
      setError,
      setLoading,
      setOrganizationPolicyHistory,
    ],
  );

  const refreshSelectedUserDetail = useOrgManagerUserDetailRefresher({
    beginRequest,
    canLoadAuthenticatedOrgData,
    orgManagerActions,
    setError,
    setLoadingUserDetail,
    setUserDetail,
  });

  const refreshOrgManager = useCallback(async () => {
    const isCurrentRequest = beginRequest("refresh");
    setLoading(true);
    setError(null);
    try {
      await refreshDirectoryAndGroups({
        clearError: false,
        manageLoading: false,
        skipNextGroupDetailsEffect: true,
      });
    } finally {
      if (isCurrentRequest()) {
        setLoading(false);
      }
    }
  }, [beginRequest, refreshDirectoryAndGroups, setError, setLoading]);

  return {
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
