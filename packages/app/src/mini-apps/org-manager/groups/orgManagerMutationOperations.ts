import type { OrganizationGroupMutationResult } from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { RESERVED_ORGANIZATION_GROUP_NAMES } from "../../../utils/organizationGroupNames";
import { ORG_MANAGER_LABELS } from "../labels";
import type { useOrgManagerRefreshers } from "../refreshers/useOrgManagerRefreshers";

type OrgManagerActions = Pick<
  ReturnType<typeof useOrgManagerActions>,
  "addUserToGroup" | "loadGroupMembers"
>;
type IsOperationActive = (organizationId: string) => boolean;
type Refreshers = ReturnType<typeof useOrgManagerRefreshers>;

export async function refreshAfterGroupMutation(input: {
  invalidateSelectedGroupDetails: Refreshers["invalidateSelectedGroupDetails"];
  isOperationActive: IsOperationActive;
  /** The mutation's own post-commit read model, applied without a re-read. */
  mutationResult: OrganizationGroupMutationResult | null;
  operationOrganizationId: string;
  refreshDirectoryAndGroups: Refreshers["refreshDirectoryAndGroups"];
  refreshSelectedGroupDetails: Refreshers["refreshSelectedGroupDetails"];
  refreshSelectedUserDetail?: Refreshers["refreshSelectedUserDetail"];
  selectedUserIdRef?: { current: string | null };
}): Promise<void> {
  const refreshedDirectory = await input.refreshDirectoryAndGroups({
    afterMutation: true,
    mutationResult: input.mutationResult,
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

// Adds the user to the group unless they already belong to it. Returns null
// when the operation went stale or the membership list failed to load.
async function ensureRosterUserInGroup(input: {
  groupId: string;
  groupName: string;
  isOperationActive: IsOperationActive;
  operationOrganizationId: string;
  orgManagerActions: OrgManagerActions;
  setError: Dispatch<SetStateAction<string | null>>;
  userId: string;
}): Promise<OrganizationGroupMutationResult | "already-member" | null> {
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
  const result = await input.orgManagerActions.addUserToGroup(
    input.groupId,
    input.userId,
    input.groupName,
  );

  return input.isOperationActive(input.operationOrganizationId) ? result : null;
}

// `targetUserId` comes from a verified identity link: admission never starts
// from a bare user ID, and the SDK refuses an unverified member regardless.
export async function prepareRosterImport(input: {
  isOperationActive: IsOperationActive;
  memberGroupId: string;
  operationOrganizationId: string;
  orgManagerActions: OrgManagerActions;
  setError: Dispatch<SetStateAction<string | null>>;
  targetUserId: string;
}): Promise<{
  mutationResult: OrganizationGroupMutationResult | null;
  userId: string;
} | null> {
  const membership = await ensureRosterUserInGroup({
    ...input,
    groupId: input.memberGroupId,
    groupName: RESERVED_ORGANIZATION_GROUP_NAMES.members,
    userId: input.targetUserId,
  });

  if (!membership) return null;
  return {
    mutationResult: membership === "already-member" ? null : membership,
    userId: input.targetUserId,
  };
}

export async function addRosterUserToGroup(input: {
  groupId: string;
  groupName: string;
  isOperationActive: IsOperationActive;
  operationOrganizationId: string;
  orgManagerActions: OrgManagerActions;
  targetUserId: string;
}): Promise<OrganizationGroupMutationResult | null> {
  const result = await input.orgManagerActions.addUserToGroup(
    input.groupId,
    input.targetUserId,
    input.groupName,
  );
  return input.isOperationActive(input.operationOrganizationId) ? result : null;
}
