import type {
  OrganizationDirectory,
  OrganizationGroupMembers,
  OrganizationGroupSummary,
} from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import type { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { refreshAfterGroupMutation } from "../groups/orgManagerMutationOperations";
import { ORG_MANAGER_LABELS } from "../labels";
import { canDisableRosterUser } from "../permissions";
import type { useOrgManagerRefreshers } from "../refreshers/useOrgManagerRefreshers";
import { runScopedOrgMutation } from "./runScopedOrgMutation";

type Refreshers = ReturnType<typeof useOrgManagerRefreshers>;

interface UseOrgManagerDisableRosterUserParams {
  appData: ReturnType<typeof useTearleadsRuntime>;
  canDisableRosterUsers: boolean;
  directory: OrganizationDirectory | null;
  groups: ReadonlyArray<OrganizationGroupSummary>;
  invalidateSelectedGroupDetails: Refreshers["invalidateSelectedGroupDetails"];
  isOperationActive: (organizationId: string) => boolean;
  memberGroupId: string | null;
  orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  refreshDirectoryAndGroups: Refreshers["refreshDirectoryAndGroups"];
  refreshSelectedGroupDetails: Refreshers["refreshSelectedGroupDetails"];
  refreshSelectedUserDetail: Refreshers["refreshSelectedUserDetail"];
  selectedUserIdRef: { current: string | null };
  setError: Dispatch<SetStateAction<string | null>>;
  setMutating: Dispatch<SetStateAction<boolean>>;
}

function findBuiltinAdminGroupId(
  groups: ReadonlyArray<OrganizationGroupSummary>,
): string | null {
  return groups.find((group) => group.isBuiltin)?.groupId ?? null;
}

function hasDirectUserMember(
  members: OrganizationGroupMembers,
  userId: string,
): boolean {
  return members.members.some((member) => member.userId === userId);
}

function collectRosterDisableMembershipTargets(input: {
  adminGroupId: string | null;
  adminMembers: OrganizationGroupMembers | null;
  disabledUserId: string;
  memberGroupId: string;
  memberMembers: OrganizationGroupMembers;
}): string[] {
  const targets: string[] = [];

  if (
    input.adminGroupId &&
    input.adminMembers &&
    hasDirectUserMember(input.adminMembers, input.disabledUserId)
  ) {
    targets.push(input.adminGroupId);
  }
  if (hasDirectUserMember(input.memberMembers, input.disabledUserId)) {
    targets.push(input.memberGroupId);
  }

  return targets;
}

async function loadRosterDisableMembershipTargets(input: {
  adminGroupId: string | null;
  disabledUserId: string;
  isOperationActive: (organizationId: string) => boolean;
  memberGroupId: string;
  organizationId: string;
  orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  setError: Dispatch<SetStateAction<string | null>>;
}): Promise<string[] | null> {
  const [memberGroupMembers, adminGroupMembers] = await Promise.all([
    input.orgManagerActions.loadGroupMembers(input.memberGroupId),
    input.adminGroupId
      ? input.orgManagerActions.loadGroupMembers(input.adminGroupId)
      : Promise.resolve(null),
  ]);
  if (!input.isOperationActive(input.organizationId)) {
    return null;
  }
  if (!memberGroupMembers || (input.adminGroupId && !adminGroupMembers)) {
    input.setError(ORG_MANAGER_LABELS.failedLoadGroupMembers);
    return null;
  }

  const mutationTargets = collectRosterDisableMembershipTargets({
    adminGroupId: input.adminGroupId,
    adminMembers: adminGroupMembers,
    disabledUserId: input.disabledUserId,
    memberGroupId: input.memberGroupId,
    memberMembers: memberGroupMembers,
  });
  if (mutationTargets.length === 0) {
    input.setError(ORG_MANAGER_LABELS.userNotFound);
    return null;
  }

  return mutationTargets;
}

async function removeRosterDisableMembershipTargets(input: {
  disabledUserId: string;
  isOperationActive: (organizationId: string) => boolean;
  organizationId: string;
  orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  targets: ReadonlyArray<string>;
}): Promise<boolean> {
  for (const groupId of input.targets) {
    if (!input.isOperationActive(input.organizationId)) {
      return false;
    }
    await input.orgManagerActions.removeUserFromGroup(
      groupId,
      input.disabledUserId,
    );
  }
  return input.isOperationActive(input.organizationId);
}

async function disableRosterUser(
  input: UseOrgManagerDisableRosterUserParams & { disabledUserId: string },
): Promise<void> {
  const targetUser =
    input.directory?.users.find(
      (user) => user.userId === input.disabledUserId,
    ) ?? null;
  const adminGroupId = findBuiltinAdminGroupId(input.groups);
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
    operationOrganizationId,
    run: async () => {
      const mutationTargets = await loadRosterDisableMembershipTargets({
        adminGroupId,
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
