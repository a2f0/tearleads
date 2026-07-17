import type {
  OrganizationDirectory,
  OrganizationGroupMembers,
  OrganizationGroupPolicyHistory,
} from "@tearleads/client-sdk";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { Dispatch, SetStateAction } from "react";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import type { useOrgManagerRefreshers } from "../hooks/useOrgManagerRefreshers";
import { ORG_MANAGER_LABELS } from "../labels";
import { projectGroupMutationResult } from "./groupMutationProjection";

type OrgManagerActions = ReturnType<typeof useOrgManagerActions>;
type IsOperationActive = (organizationId: string) => boolean;
type Refreshers = ReturnType<typeof useOrgManagerRefreshers>;

export async function refreshAfterGroupMutation(input: {
  isOperationActive: IsOperationActive;
  mutationProjection?: {
    readonly bundle: PrincipalPolicyBundleResponse;
    readonly groupId: string;
    readonly setGroupPolicyHistory: Dispatch<
      SetStateAction<OrganizationGroupPolicyHistory | null>
    >;
    readonly setMembers: Dispatch<
      SetStateAction<OrganizationGroupMembers | null>
    >;
  };
  operationOrganizationId: string;
  refreshDirectoryAndGroups: Refreshers["refreshDirectoryAndGroups"];
  refreshSelectedGroupDetails: Refreshers["refreshSelectedGroupDetails"];
  refreshSelectedUserDetail?: Refreshers["refreshSelectedUserDetail"];
  selectedUserIdRef?: { current: string | null };
}): Promise<void> {
  const refreshedDirectory = await input.refreshDirectoryAndGroups({
    skipNextGroupDetailsEffect: true,
  });
  if (!input.isOperationActive(input.operationOrganizationId)) {
    return;
  }
  if (refreshedDirectory.didLoad) {
    const mutationProjection = input.mutationProjection;
    const projection =
      mutationProjection &&
      refreshedDirectory.groupId === mutationProjection.groupId
        ? projectGroupMutationResult({
            bundle: mutationProjection.bundle,
            directory: refreshedDirectory.directory,
            groupId: mutationProjection.groupId,
            groups: refreshedDirectory.groups,
          })
        : null;
    if (projection) {
      mutationProjection?.setMembers(projection.members);
      mutationProjection?.setGroupPolicyHistory(projection.policyHistory);
    } else {
      await input.refreshSelectedGroupDetails(refreshedDirectory.groupId);
    }
  }
  if (!input.isOperationActive(input.operationOrganizationId)) {
    return;
  }
  if (input.refreshSelectedUserDetail && input.selectedUserIdRef) {
    await input.refreshSelectedUserDetail(input.selectedUserIdRef.current);
  }
}

export async function prepareRosterImport(input: {
  directory: OrganizationDirectory;
  isOperationActive: IsOperationActive;
  memberGroupId: string;
  operationOrganizationId: string;
  orgManagerActions: OrgManagerActions;
  setError: Dispatch<SetStateAction<string | null>>;
  targetUserId: string;
}): Promise<{ userId: string } | null> {
  const directoryUser = input.directory.users.find(
    (user) => user.userId === input.targetUserId,
  );
  const [targetUser, memberGroupDetails] = await Promise.all([
    directoryUser
      ? Promise.resolve({ userId: directoryUser.userId })
      : input.orgManagerActions.importUserById(input.targetUserId),
    input.orgManagerActions.loadGroupDetails(input.memberGroupId),
  ]);
  if (!input.isOperationActive(input.operationOrganizationId)) {
    return null;
  }
  if (!targetUser) {
    input.setError(ORG_MANAGER_LABELS.userNotFound);
    return null;
  }
  if (!memberGroupDetails.members) {
    input.setError(ORG_MANAGER_LABELS.failedLoadGroupMembers);
    return null;
  }

  const alreadyMember = memberGroupDetails.members.members.some(
    (member) =>
      member.memberPrincipalType === "user" &&
      member.memberPrincipalId === targetUser.userId,
  );
  if (!alreadyMember) {
    await input.orgManagerActions.addUserToGroup(
      input.memberGroupId,
      targetUser.userId,
    );
  }

  return input.isOperationActive(input.operationOrganizationId)
    ? targetUser
    : null;
}

export async function addRosterUserToGroup(input: {
  directoryUser: OrganizationDirectory["users"][number] | undefined;
  groupId: string;
  isOperationActive: IsOperationActive;
  operationOrganizationId: string;
  orgManagerActions: OrgManagerActions;
  setError: Dispatch<SetStateAction<string | null>>;
  targetUserId: string;
}): Promise<PrincipalPolicyBundleResponse | null> {
  const targetUser = input.directoryUser
    ? { userId: input.directoryUser.userId }
    : await input.orgManagerActions.importUserById(input.targetUserId);
  if (!input.isOperationActive(input.operationOrganizationId)) {
    return null;
  }
  if (!targetUser) {
    input.setError(ORG_MANAGER_LABELS.userNotFound);
    return null;
  }

  const bundle = await input.orgManagerActions.addUserToGroup(
    input.groupId,
    targetUser.userId,
  );
  return input.isOperationActive(input.operationOrganizationId) ? bundle : null;
}
