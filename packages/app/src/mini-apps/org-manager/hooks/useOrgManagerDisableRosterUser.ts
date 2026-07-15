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
import { setUnknownError } from "../refresh";
import type { useOrgManagerRefreshers } from "./useOrgManagerRefreshers";

type Refreshers = ReturnType<typeof useOrgManagerRefreshers>;

interface UseOrgManagerDisableRosterUserParams {
  appData: ReturnType<typeof useTearleadsRuntime>;
  canDisableRosterUsers: boolean;
  directory: OrganizationDirectory | null;
  groups: ReadonlyArray<OrganizationGroupSummary>;
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
  return members.members.some(
    (member) =>
      member.memberPrincipalType === "user" &&
      member.memberPrincipalId === userId,
  );
}

function canDisableRosterUserRequest(input: {
  authUserId: string | null;
  canDisableRosterUsers: boolean;
  directory: OrganizationDirectory | null;
  memberGroupId: string | null;
  targetUser: OrganizationDirectory["users"][number] | null;
}): boolean {
  return Boolean(
    input.canDisableRosterUsers &&
      input.directory &&
      input.memberGroupId &&
      input.targetUser &&
      input.targetUser.status === "active" &&
      !input.targetUser.isSelf &&
      input.targetUser.userId !== input.authUserId,
  );
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
  const [memberGroupDetails, adminGroupDetails] = await Promise.all([
    input.orgManagerActions.loadGroupDetails(input.memberGroupId),
    input.adminGroupId
      ? input.orgManagerActions.loadGroupDetails(input.adminGroupId)
      : Promise.resolve(null),
  ]);
  if (!input.isOperationActive(input.organizationId)) {
    return null;
  }
  if (
    !memberGroupDetails?.members ||
    (input.adminGroupId && !adminGroupDetails?.members)
  ) {
    input.setError(ORG_MANAGER_LABELS.failedLoadGroupMembers);
    return null;
  }

  const mutationTargets = collectRosterDisableMembershipTargets({
    adminGroupId: input.adminGroupId,
    adminMembers: adminGroupDetails?.members ?? null,
    disabledUserId: input.disabledUserId,
    memberGroupId: input.memberGroupId,
    memberMembers: memberGroupDetails.members,
  });
  if (mutationTargets.length === 0) {
    input.setError(ORG_MANAGER_LABELS.userNotFound);
    return null;
  }

  return mutationTargets;
}

async function removeRosterDisableMembershipTargets(input: {
  directory: OrganizationDirectory;
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
      input.directory.currentUser.isOrgAdmin,
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
    !canDisableRosterUserRequest({
      authUserId: input.appData.auth.userId,
      canDisableRosterUsers: input.canDisableRosterUsers,
      directory: input.directory,
      memberGroupId: input.memberGroupId,
      targetUser,
    }) ||
    !input.directory ||
    !input.memberGroupId
  ) {
    return;
  }
  const operationOrganizationId = input.directory.organizationId;
  if (!input.isOperationActive(operationOrganizationId)) {
    return;
  }

  input.setMutating(true);
  input.setError(null);
  try {
    const mutationTargets = await loadRosterDisableMembershipTargets({
      adminGroupId,
      disabledUserId: input.disabledUserId,
      isOperationActive: input.isOperationActive,
      memberGroupId: input.memberGroupId,
      organizationId: operationOrganizationId,
      orgManagerActions: input.orgManagerActions,
      setError: input.setError,
    });
    if (!mutationTargets) {
      return;
    }

    const removed = await removeRosterDisableMembershipTargets({
      directory: input.directory,
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
      isOperationActive: input.isOperationActive,
      operationOrganizationId,
      refreshDirectoryAndGroups: input.refreshDirectoryAndGroups,
      refreshSelectedGroupDetails: input.refreshSelectedGroupDetails,
      refreshSelectedUserDetail: input.refreshSelectedUserDetail,
      selectedUserIdRef: input.selectedUserIdRef,
    });
  } catch (error) {
    if (input.isOperationActive(operationOrganizationId)) {
      setUnknownError(input.setError, error);
    }
  } finally {
    if (input.isOperationActive(operationOrganizationId)) {
      input.setMutating(false);
    }
  }
}

export function useOrgManagerDisableRosterUser(
  params: UseOrgManagerDisableRosterUserParams,
) {
  const {
    appData,
    canDisableRosterUsers,
    directory,
    groups,
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
