import type {
  OrganizationContainerGrants,
  OrganizationDataUsage,
  OrganizationDirectory,
  OrganizationDirectoryAndGroups,
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
import { useOrgManagerGroupContainersRefresher } from "../groups/useOrgManagerGroupContainersRefresher";
import { useOrgManagerGroupDetailsRefresher } from "../groups/useOrgManagerGroupDetailsRefresher";
import { ORG_MANAGER_LABELS } from "../labels";
import { useOrgManagerVisibleRefresher } from "../organization/useOrgManagerVisibleRefresher";
import {
  clearErrorIfRequested,
  type DataUsageRefreshOptions,
  type DirectoryRefreshOptions,
  type DirectoryRefreshResult,
  directoryLoadOptions,
  type GrantsRefreshOptions,
  type GroupDetailsEffectKey,
  getRefreshBehavior,
  type RefreshBehaviorOptions,
  setLoadingIfManaged,
  setUnknownError,
} from "../refresh";
import {
  type OrgManagerView,
  resolveOrgManagerSelectedGroupId,
} from "../routes";
import type { useOrgManagerRequestGuard } from "./useOrgManagerRequestGuard";
import { useOrgManagerUserDetailRefresher } from "./useOrgManagerUserDetailRefresher";

type BeginRequest = ReturnType<typeof useOrgManagerRequestGuard>;

type LocalDirectoryLoadStep =
  | { readonly kind: "continue" }
  | { readonly kind: "done"; readonly result: DirectoryRefreshResult };

async function loadLocalDirectoryStep(input: {
  readonly apply: (
    value: OrganizationDirectoryAndGroups,
  ) => DirectoryRefreshResult;
  readonly isCurrentRequest: () => boolean;
  readonly localOnly: boolean;
  readonly load: () => Promise<OrganizationDirectoryAndGroups | null>;
  readonly onMissing: () => void;
}): Promise<LocalDirectoryLoadStep> {
  const localDirectoryState = await input.load();
  if (!input.isCurrentRequest()) {
    return { kind: "done", result: { didLoad: false, groupId: null } };
  }
  if (!localDirectoryState) {
    if (!input.localOnly) {
      return { kind: "continue" };
    }
    input.onMissing();
    return { kind: "done", result: { didLoad: false, groupId: null } };
  }

  const result = input.apply(localDirectoryState);
  return input.localOnly ? { kind: "done", result } : { kind: "continue" };
}

interface OrgManagerRefreshersParams {
  appData: ReturnType<typeof useTearleadsRuntime>;
  beginRequest: BeginRequest;
  canLoadAuthenticatedOrgData: boolean;
  orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  resetSelectedRosterUser: () => void;
  selectGroup: (groupId: string | null) => void;
  selectedGroupIdRef: { current: string | null };
  selectedGroupStateHashRef: { current: string | null };
  selectedUserIdRef: { current: string | null };
  skippedGroupDetailsEffectRef: { current: GroupDetailsEffectKey | null };
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
  setReadModelCursor: Dispatch<SetStateAction<string | null>>;
  setIsCreateGroupDialogOpen: Dispatch<SetStateAction<boolean>>;
  setIsImportUserDialogOpen: Dispatch<SetStateAction<boolean>>;
  setUserDetail: Dispatch<SetStateAction<OrganizationUserDetail | null>>;
  view: OrgManagerView;
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
    selectedGroupStateHashRef,
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
    setReadModelCursor,
    setIsCreateGroupDialogOpen,
    setIsImportUserDialogOpen,
    setUserDetail,
    view,
  } = params;

  const refreshSelectedGroupDetails = useOrgManagerGroupDetailsRefresher({
    appData,
    beginRequest,
    orgManagerActions,
    setError,
    setGroupPolicyHistory,
    setMembers,
  });
  const invalidateSelectedGroupDetails = useCallback(() => {
    beginRequest("groupDetails");
  }, [beginRequest]);
  const refreshSelectedGroupContainers = useOrgManagerGroupContainersRefresher({
    beginRequest,
    canLoadAuthenticatedOrgData,
    orgManagerActions,
    setError,
    setGroupContainers,
  });

  const resetDirectoryState = useCallback(() => {
    setDirectory(null);
    setGroups([]);
    setMemberGroupId(null);
    setMembers(null);
    setGroupContainers(null);
    setGroupPolicyHistory(null);
    setReadModelCursor(null);
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
    setReadModelCursor,
  ]);

  const loadDirectoryAndGroups = useCallback(
    async (
      isCurrentRequest: () => boolean,
      options: Pick<
        DirectoryRefreshOptions,
        "afterMutation" | "localOnly" | "skipNextGroupDetailsEffect"
      > = {},
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
        setReadModelCursor(nextDirectoryState.readModelCursor);
        const currentSelectedGroupId = selectedGroupIdRef.current;
        const nextSelectedGroupId = resolveOrgManagerSelectedGroupId(
          currentSelectedGroupId,
          nextDirectoryState.groups,
        );
        const nextSelectedGroupStateHash =
          nextDirectoryState.groups.find(
            (group) => group.groupId === nextSelectedGroupId,
          )?.currentState?.stateHash ?? null;
        if (
          options.skipNextGroupDetailsEffect &&
          (nextSelectedGroupId !== currentSelectedGroupId ||
            nextSelectedGroupStateHash !== selectedGroupStateHashRef.current)
        ) {
          skippedGroupDetailsEffectRef.current = {
            groupId: nextSelectedGroupId,
            stateHash: nextSelectedGroupStateHash,
          };
        }
        selectedGroupStateHashRef.current = nextSelectedGroupStateHash;
        if (nextSelectedGroupId !== currentSelectedGroupId) {
          selectGroup(nextSelectedGroupId);
        }
        return {
          didLoad: true,
          directory: nextDirectoryState.directory,
          groupId: nextSelectedGroupId,
          groups: nextDirectoryState.groups,
        };
      };

      if (!options.afterMutation) {
        const localStep = await loadLocalDirectoryStep({
          apply: applyDirectoryAndGroups,
          isCurrentRequest,
          load: orgManagerActions.loadLocalDirectoryAndGroups,
          localOnly: options.localOnly ?? false,
          onMissing: () => {
            resetDirectoryState();
            setError(ORG_MANAGER_LABELS.failedLoadDirectoryGroups);
          },
        });
        if (localStep.kind === "done") {
          return localStep.result;
        }
      }

      const nextDirectoryState = options.afterMutation
        ? await orgManagerActions.loadDirectoryAndGroupsAfterMutation()
        : await orgManagerActions.loadDirectoryAndGroups();
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
      selectedGroupStateHashRef,
      setDirectory,
      setError,
      setGroups,
      setMemberGroupId,
      setReadModelCursor,
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

  const refreshOrgManager = useOrgManagerVisibleRefresher({
    beginRequest,
    refreshDataUsage,
    refreshDirectoryAndGroups,
    refreshGrants,
    refreshOrganizationPolicyHistory,
    refreshSelectedGroupContainers,
    refreshSelectedGroupDetails,
    refreshSelectedUserDetail,
    selectedUserIdRef,
    setError,
    setLoading,
    view,
  });

  return {
    invalidateSelectedGroupDetails,
    refreshDataUsage,
    refreshDirectoryAndGroups,
    refreshGrants,
    refreshOrganizationPolicyHistory,
    refreshOrgManager,
    refreshSelectedGroupContainers,
    refreshSelectedGroupDetails,
    refreshSelectedUserDetail,
    resetDirectoryState,
  };
}
