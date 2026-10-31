import type {
  OrganizationDirectory,
  OrganizationGroupMutationResult,
  OrganizationGroupSummary,
} from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import type { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { refreshAfterGroupMutation } from "../groups/orgManagerMutationOperations";
import { runScopedOrgMutation } from "../hooks/runScopedOrgMutation";
import { canDisableRosterUser } from "../permissions";
import type { useOrgManagerRefreshers } from "../refreshers/useOrgManagerRefreshers";
import {
  loadRosterDisableMembershipTargets,
  type RosterDisableMembershipTarget,
} from "./rosterDisableMembershipTargets";

type Refreshers = ReturnType<typeof useOrgManagerRefreshers>;

interface UseOrgManagerDisableRosterUserParams {
  appData: ReturnType<typeof useTearleadsRuntime>;
  canDisableRosterUsers: boolean;
  directory: OrganizationDirectory | null;
  groups: ReadonlyArray<OrganizationGroupSummary>;
  invalidateSelectedGroupDetails: Refreshers["invalidateSelectedGroupDetails"];
  isOperationActive: (organizationId: string) => boolean;
  logError: (message: string | Error, cause?: unknown) => void;
  memberGroupId: string | null;
  orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  refreshDirectoryAndGroups: Refreshers["refreshDirectoryAndGroups"];
  refreshSelectedGroupDetails: Refreshers["refreshSelectedGroupDetails"];
  refreshSelectedUserDetail: Refreshers["refreshSelectedUserDetail"];
  selectedUserIdRef: { current: string | null };
  setError: Dispatch<SetStateAction<string | null>>;
  setMutating: Dispatch<SetStateAction<boolean>>;
}

async function removeRosterDisableMembershipTargets(input: {
  disabledUserId: string;
  isOperationActive: (organizationId: string) => boolean;
  organizationId: string;
  orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  targets: ReadonlyArray<RosterDisableMembershipTarget>;
}): Promise<{ mutationResult: OrganizationGroupMutationResult | null } | null> {
  // The last removal's post-commit read model already reflects every earlier
  // one, so the refresh applies it instead of reading again.
  let mutationResult: OrganizationGroupMutationResult | null = null;
  for (const { groupId, name } of input.targets) {
    if (!input.isOperationActive(input.organizationId)) {
      return null;
    }
    mutationResult = await input.orgManagerActions.removeUserFromGroup(
      groupId,
      input.disabledUserId,
      name,
    );
  }
  return input.isOperationActive(input.organizationId)
    ? { mutationResult }
    : null;
}

async function disableRosterUser(
  input: UseOrgManagerDisableRosterUserParams & { disabledUserId: string },
): Promise<void> {
  const targetUser =
    input.directory?.users.find(
      (user) => user.userId === input.disabledUserId,
    ) ?? null;
  if (
    !input.directory ||
    !input.memberGroupId ||
    !canDisableRosterUser({
      authUserId: input.appData.auth.userId,
      canDisableRosterUsers: input.canDisableRosterUsers,
      targetUser,
    })
  ) {
    return;
  }
  const memberGroupId = input.memberGroupId;
  const operationOrganizationId = input.directory.organizationId;
  await runScopedOrgMutation({
    isOperationActive: input.isOperationActive,
    logError: input.logError,
    operationOrganizationId,
    run: async () => {
      const mutationTargets = await loadRosterDisableMembershipTargets({
        groups: input.groups,
        disabledUserId: input.disabledUserId,
        isOperationActive: input.isOperationActive,
        memberGroupId,
        organizationId: operationOrganizationId,
        orgManagerActions: input.orgManagerActions,
        setError: input.setError,
      });
      if (!mutationTargets) {
        return;
      }

      const removed = await removeRosterDisableMembershipTargets({
        disabledUserId: input.disabledUserId,
        isOperationActive: input.isOperationActive,
        organizationId: operationOrganizationId,
        orgManagerActions: input.orgManagerActions,
        targets: mutationTargets,
      });
      if (!removed) {
        return;
      }

      await refreshAfterGroupMutation({
        invalidateSelectedGroupDetails: input.invalidateSelectedGroupDetails,
        isOperationActive: input.isOperationActive,
        mutationResult: removed.mutationResult,
        operationOrganizationId,
        refreshDirectoryAndGroups: input.refreshDirectoryAndGroups,
        refreshSelectedGroupDetails: input.refreshSelectedGroupDetails,
        refreshSelectedUserDetail: input.refreshSelectedUserDetail,
        selectedUserIdRef: input.selectedUserIdRef,
      });
    },
    setError: input.setError,
    setMutating: input.setMutating,
  });
}

export function useOrgManagerDisableRosterUser(
  params: UseOrgManagerDisableRosterUserParams,
) {
  const {
    appData,
    canDisableRosterUsers,
    directory,
    groups,
    invalidateSelectedGroupDetails,
    isOperationActive,
    logError,
    memberGroupId,
    orgManagerActions,
    refreshDirectoryAndGroups,
    refreshSelectedGroupDetails,
    refreshSelectedUserDetail,
    selectedUserIdRef,
    setError,
    setMutating,
  } = params;

  return useCallback(
    (disabledUserId: string) =>
      disableRosterUser({
        appData,
        canDisableRosterUsers,
        directory,
        disabledUserId,
        groups,
        invalidateSelectedGroupDetails,
        isOperationActive,
        logError,
        memberGroupId,
        orgManagerActions,
        refreshDirectoryAndGroups,
        refreshSelectedGroupDetails,
        refreshSelectedUserDetail,
        selectedUserIdRef,
        setError,
        setMutating,
      }),
    [
      appData.auth.userId,
      canDisableRosterUsers,
      directory,
      groups,
      invalidateSelectedGroupDetails,
      isOperationActive,
      logError,
      memberGroupId,
      orgManagerActions,
      refreshDirectoryAndGroups,
      refreshSelectedGroupDetails,
      refreshSelectedUserDetail,
      selectedUserIdRef,
      setError,
      setMutating,
    ],
  );
}
