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
} from "@symcrypt/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import type { useSymCryptRuntime } from "../../../providers/sdk/SymCryptProvider";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import type { useOrgManagerRequestGuard } from "../hooks/useOrgManagerRequestGuard";
import { ORG_MANAGER_LABELS } from "../labels";
import {
  clearErrorIfRequested,
  type DirectoryRefreshOptions,
  type DirectoryRefreshResult,
  directoryLoadOptions,
  type GroupDetailsEffectKey,
  getRefreshBehavior,
  type RefreshBehaviorOptions,
  runScopedRefresher,
  setLoadingIfManaged,
  setUnknownError,
} from "../refresh";
import {
  type OrgManagerView,
  resolveOrgManagerSelectedGroupId,
} from "../routes";
import { useOrgManagerDataUsageRefresher } from "./useOrgManagerDataUsageRefresher";
import { useOrgManagerGroupContainersRefresher } from "./useOrgManagerGroupContainersRefresher";
import { useOrgManagerGroupDetailsRefresher } from "./useOrgManagerGroupDetailsRefresher";
import { useOrgManagerUserDetailRefresher } from "./useOrgManagerUserDetailRefresher";
import { useOrgManagerVisibleRefresher } from "./useOrgManagerVisibleRefresher";

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

/**
 * A null reconcile is either a transient decline (offline, database not
 * ready) or an authoritative denial that purged the projection. Reread the
 * durable local projection to tell them apart: retained rows are
 * last-known-good and must stay painted; absence is authoritative.
 */
async function resolveDeclinedReconcile(input: {
  readonly apply: (
    value: OrganizationDirectoryAndGroups,
  ) => DirectoryRefreshResult;
  readonly isCurrentRequest: () => boolean;
  readonly load: () => Promise<OrganizationDirectoryAndGroups | null>;
  readonly onPurged: () => void;
}): Promise<DirectoryRefreshResult> {
  const retainedDirectoryState = await input.load();
  if (!input.isCurrentRequest()) {
    return { didLoad: false, groupId: null };
  }
  if (retainedDirectoryState) {
    return input.apply(retainedDirectoryState);
  }
  input.onPurged();
  return { didLoad: false, groupId: null };
}

interface OrgManagerRefreshersParams {
  appData: ReturnType<typeof useSymCryptRuntime>;
  beginRequest: BeginRequest;
  canLoadAuthenticatedOrgData: boolean;
  dataUsageRef: { current: OrganizationDataUsage | null };
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
  markDataUsageSettled: () => void;
  markDirectorySettled: () => void;
  markGrantsSettled: () => void;
  markGroupDetailsSettled: (groupId: string | null) => void;
  markOrganizationPolicyHistorySettled: () => void;
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
    dataUsageRef,
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
    markDataUsageSettled,
    markDirectorySettled,
    markGrantsSettled,
    markGroupDetailsSettled,
    markOrganizationPolicyHistorySettled,
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
    markGroupDetailsSettled,
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
  const refreshDataUsage = useOrgManagerDataUsageRefresher({
    markDataUsageSettled,
    appData,
    beginRequest,
    canLoadAuthenticatedOrgData,
    dataUsageRef,
    orgManagerActions,
    setDataUsage,
    setError,
    setLoading,
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
            // A missing local projection on a local-only pass means the
            // organization has not synced yet, not that loading failed; the
            // background feed reconcile paints it once the snapshot lands.
            resetDirectoryState();
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

      return resolveDeclinedReconcile({
        apply: applyDirectoryAndGroups,
        isCurrentRequest,
        load: orgManagerActions.loadLocalDirectoryAndGroups,
        onPurged: () => {
          resetDirectoryState();
          setError(ORG_MANAGER_LABELS.failedLoadDirectoryGroups);
        },
      });
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
          // Settled means "this scope has been looked at", whatever the pass
          // produced: from here on an empty projection is a real answer.
          markDirectorySettled();
        }
      }
    },
    [
      beginRequest,
      loadDirectoryAndGroups,
      markDirectorySettled,
      selectedGroupIdRef,
      setError,
      setLoading,
    ],
  );

  const refreshGrants = useCallback(
    (options: RefreshBehaviorOptions = {}) =>
      runScopedRefresher({
        apply: (nextGrants) => {
          if (nextGrants === null) {
            setGrants(null);
            setError(ORG_MANAGER_LABELS.failedLoadGrants);
            return;
          }

          setGrants(nextGrants);
        },
        beginRequest,
        load: canLoadAuthenticatedOrgData ? orgManagerActions.loadGrants : null,
        onError: (nextError) => {
          setGrants(null);
          setUnknownError(setError, nextError);
        },
        onSettled: markGrantsSettled,
        onUnavailable: () => setGrants(null),
        options,
        requestKind: "grants",
        setError,
        setLoading,
      }),
    [
      canLoadAuthenticatedOrgData,
      beginRequest,
      markGrantsSettled,
      orgManagerActions,
      setError,
      setGrants,
      setLoading,
    ],
  );

  const refreshOrganizationPolicyHistory = useCallback(
    (options: RefreshBehaviorOptions = {}) =>
      runScopedRefresher({
        apply: setOrganizationPolicyHistory,
        beginRequest,
        load: canLoadAuthenticatedOrgData
          ? orgManagerActions.loadPolicyHistory
          : null,
        onError: (nextError) => {
          setOrganizationPolicyHistory(null);
          setUnknownError(setError, nextError);
        },
        onSettled: markOrganizationPolicyHistorySettled,
        onUnavailable: () => setOrganizationPolicyHistory(null),
        options,
        requestKind: "organizationPolicyHistory",
        setError,
        setLoading,
      }),
    [
      canLoadAuthenticatedOrgData,
      beginRequest,
      markOrganizationPolicyHistorySettled,
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
