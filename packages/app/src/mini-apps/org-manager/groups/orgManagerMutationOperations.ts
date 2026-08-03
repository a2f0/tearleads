import type { OrganizationDirectory } from "@tearleads/client-sdk";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { Dispatch, SetStateAction } from "react";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import type { useOrgManagerRefreshers } from "../hooks/useOrgManagerRefreshers";
import { ORG_MANAGER_LABELS } from "../labels";

type OrgManagerActions = ReturnType<typeof useOrgManagerActions>;
type IsOperationActive = (organizationId: string) => boolean;
type Refreshers = ReturnType<typeof useOrgManagerRefreshers>;

export async function refreshAfterGroupMutation(input: {
  invalidateSelectedGroupDetails: Refreshers["invalidateSelectedGroupDetails"];
  isOperationActive: IsOperationActive;
  operationOrganizationId: string;
  refreshDirectoryAndGroups: Refreshers["refreshDirectoryAndGroups"];
  refreshSelectedGroupDetails: Refreshers["refreshSelectedGroupDetails"];
  refreshSelectedUserDetail?: Refreshers["refreshSelectedUserDetail"];
  selectedUserIdRef?: { current: string | null };
}): Promise<void> {
  const refreshedDirectory = await input.refreshDirectoryAndGroups({
    afterMutation: true,
    skipNextGroupDetailsEffect: true,
  });
  if (!input.isOperationActive(input.operationOrganizationId)) {
    return;
  }
  if (refreshedDirectory.didLoad) {
    input.invalidateSelectedGroupDetails();
    await input.refreshSelectedGroupDetails(refreshedDirectory.groupId);
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
  const [targetUser, memberGroupMembers] = await Promise.all([
    directoryUser
      ? Promise.resolve({ userId: directoryUser.userId })
      : input.orgManagerActions.importUserById(input.targetUserId),
    input.orgManagerActions.loadGroupMembers(input.memberGroupId),
  ]);
  if (!input.isOperationActive(input.operationOrganizationId)) {
    return null;
  }
  if (!targetUser) {
    input.setError(ORG_MANAGER_LABELS.userNotFound);
    return null;
  }
  if (!memberGroupMembers) {
    input.setError(ORG_MANAGER_LABELS.failedLoadGroupMembers);
    return null;
  }

  const alreadyMember = memberGroupMembers.members.some(
    (member) => member.userId === targetUser.userId,
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
  isAdminGroup: boolean;
  isOperationActive: IsOperationActive;
  memberGroupId: string | null;
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

  // An admin must be an organization member. Nesting used to supply that for
  // free — Members contained Admins — so adding straight to Admins was enough.
  // Now Members has to be seeded first, and the server rejects the write if it
  // is not. Ordinary groups keep their old behaviour: they may hold users who
  // are not Members, so seeding them would change who gets billed.
  if (input.isAdminGroup && input.memberGroupId) {
    const memberGroupMembers = await input.orgManagerActions.loadGroupMembers(
      input.memberGroupId,
    );
    if (!input.isOperationActive(input.operationOrganizationId)) {
      return null;
    }
    if (!memberGroupMembers) {
      input.setError(ORG_MANAGER_LABELS.failedLoadGroupMembers);
      return null;
    }
    const alreadyMember = memberGroupMembers.members.some(
      (member) => member.userId === targetUser.userId,
    );
    if (!alreadyMember) {
      await input.orgManagerActions.addUserToGroup(
        input.memberGroupId,
        targetUser.userId,
      );
      if (!input.isOperationActive(input.operationOrganizationId)) {
        return null;
      }
    }
  }

  const bundle = await input.orgManagerActions.addUserToGroup(
    input.groupId,
    targetUser.userId,
  );
  return input.isOperationActive(input.operationOrganizationId) ? bundle : null;
}
