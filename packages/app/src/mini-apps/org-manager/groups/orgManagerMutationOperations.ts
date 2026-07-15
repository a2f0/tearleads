import type { OrganizationDirectory } from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import type { useOrgManagerRefreshers } from "../hooks/useOrgManagerRefreshers";
import { ORG_MANAGER_LABELS } from "../labels";

type OrgManagerActions = ReturnType<typeof useOrgManagerActions>;
type IsOperationActive = (organizationId: string) => boolean;
type Refreshers = ReturnType<typeof useOrgManagerRefreshers>;

export async function refreshAfterGroupMutation(input: {
  isOperationActive: IsOperationActive;
  operationOrganizationId: string;
  refreshDirectoryAndGroups: Refreshers["refreshDirectoryAndGroups"];
  refreshSelectedGroupDetails: Refreshers["refreshSelectedGroupDetails"];
  refreshSelectedUserDetail: Refreshers["refreshSelectedUserDetail"];
  selectedUserIdRef: { current: string | null };
}): Promise<void> {
  const refreshedDirectory = await input.refreshDirectoryAndGroups({
    skipNextGroupDetailsEffect: true,
  });
  if (!input.isOperationActive(input.operationOrganizationId)) {
    return;
  }
  if (refreshedDirectory.didLoad) {
    await input.refreshSelectedGroupDetails(refreshedDirectory.groupId);
  }
  if (!input.isOperationActive(input.operationOrganizationId)) {
    return;
  }
  await input.refreshSelectedUserDetail(input.selectedUserIdRef.current);
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
      input.directory.currentUser.isOrgAdmin,
    );
  }

  return input.isOperationActive(input.operationOrganizationId)
    ? targetUser
    : null;
}

export async function addRosterUserToGroup(input: {
  directory: OrganizationDirectory;
  directoryUser: OrganizationDirectory["users"][number] | undefined;
  groupId: string;
  isOperationActive: IsOperationActive;
  operationOrganizationId: string;
  orgManagerActions: OrgManagerActions;
  setError: Dispatch<SetStateAction<string | null>>;
  targetUserId: string;
}): Promise<boolean> {
  const targetUser = input.directoryUser
    ? { userId: input.directoryUser.userId }
    : await input.orgManagerActions.importUserById(input.targetUserId);
  if (!input.isOperationActive(input.operationOrganizationId)) {
    return false;
  }
  if (!targetUser) {
    input.setError(ORG_MANAGER_LABELS.userNotFound);
    return false;
  }

  await input.orgManagerActions.addUserToGroup(
    input.groupId,
    targetUser.userId,
    input.directory.currentUser.isOrgAdmin,
  );
  return input.isOperationActive(input.operationOrganizationId);
}
