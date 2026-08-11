import type { OrganizationDirectory } from "@tearleads/client-sdk";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { Dispatch, SetStateAction } from "react";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { ORG_MANAGER_LABELS } from "../labels";
import type { useOrgManagerRefreshers } from "../refreshers/useOrgManagerRefreshers";

type OrgManagerActions = Pick<
  ReturnType<typeof useOrgManagerActions>,
  "addUserToGroup" | "importUserById" | "loadGroupMembers"
>;
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

// Resolves the target user from the directory, importing them by id when the
// roster does not know them yet.
async function resolveRosterTargetUser(input: {
  directoryUser: OrganizationDirectory["users"][number] | undefined;
  isOperationActive: IsOperationActive;
  operationOrganizationId: string;
  orgManagerActions: OrgManagerActions;
  setError: Dispatch<SetStateAction<string | null>>;
  targetUserId: string;
}): Promise<{ userId: string } | null> {
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

  return targetUser;
}

// Adds the user to the group unless they already belong to it. Returns null
// when the operation went stale or the membership list failed to load.
async function ensureRosterUserInGroup(input: {
  groupId: string;
  isOperationActive: IsOperationActive;
  operationOrganizationId: string;
  orgManagerActions: OrgManagerActions;
  setError: Dispatch<SetStateAction<string | null>>;
  userId: string;
}): Promise<"added" | "already-member" | null> {
  const groupMembers = await input.orgManagerActions.loadGroupMembers(
    input.groupId,
  );
  if (!input.isOperationActive(input.operationOrganizationId)) {
    return null;
  }
  if (!groupMembers) {
    input.setError(ORG_MANAGER_LABELS.failedLoadGroupMembers);
    return null;
  }

  const alreadyMember = groupMembers.members.some(
    (member) => member.userId === input.userId,
  );
  if (alreadyMember) {
    return "already-member";
  }
  await input.orgManagerActions.addUserToGroup(input.groupId, input.userId);

  return input.isOperationActive(input.operationOrganizationId)
    ? "added"
    : null;
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
  const targetUser = await resolveRosterTargetUser({
    ...input,
    directoryUser: input.directory.users.find(
      (user) => user.userId === input.targetUserId,
    ),
  });
  if (!targetUser) {
    return null;
  }

  const membership = await ensureRosterUserInGroup({
    ...input,
    groupId: input.memberGroupId,
    userId: targetUser.userId,
  });

  return membership ? targetUser : null;
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
  const targetUser = await resolveRosterTargetUser(input);
  if (!targetUser) {
    return null;
  }

  let seededMembership = false;
  // An admin must be an organization member. Nesting used to supply that for
  // free — Members contained Admins — so adding straight to Admins was enough.
  // Now Members has to be seeded first, and the server rejects the write if it
  // is not. Ordinary groups keep their old behaviour: they may hold users who
  // are not Members, so seeding them would change who gets billed.
  if (input.isAdminGroup && input.memberGroupId) {
    const membership = await ensureRosterUserInGroup({
      ...input,
      groupId: input.memberGroupId,
      userId: targetUser.userId,
    });
    if (!membership) {
      return null;
    }
    seededMembership = membership === "added";
  }

  // Two writes cannot be one transaction, so the Admins half can fail with the
  // Members half already committed. Say so plainly: the user really is an
  // organization member and really is billed, and silently reporting "add
  // failed" would leave that invisible.
  try {
    const bundle = await input.orgManagerActions.addUserToGroup(
      input.groupId,
      targetUser.userId,
    );
    return input.isOperationActive(input.operationOrganizationId)
      ? bundle
      : null;
  } catch (error) {
    if (
      seededMembership &&
      input.isOperationActive(input.operationOrganizationId)
    ) {
      input.setError(ORG_MANAGER_LABELS.failedAddAdminAfterMemberAdd);
      return null;
    }
    throw error;
  }
}
