import type {
  OrganizationDirectory,
  OrganizationGroupMembers,
  OrganizationGroupSummary,
} from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import type { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { ORG_MANAGER_LABELS } from "../labels";
import { currentGroupUserRecipients } from "../recipients";
import { setUnknownError } from "../refresh";
import type { useOrgManagerRefreshers } from "./useOrgManagerRefreshers";

type Refreshers = ReturnType<typeof useOrgManagerRefreshers>;

interface UseOrgManagerDisableRosterUserParams {
  appData: ReturnType<typeof useTearleadsRuntime>;
  canDisableRosterUsers: boolean;
  directory: OrganizationDirectory | null;
  groups: ReadonlyArray<OrganizationGroupSummary>;
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

function remainingGroupUserRecipients(input: {
  directory: OrganizationDirectory;
  members: OrganizationGroupMembers;
  removedUserId: string;
}) {
  return currentGroupUserRecipients({
    directory: input.directory,
    members: input.members,
  }).filter((user) => user.userId !== input.removedUserId);
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
}): Array<{ groupId: string; members: OrganizationGroupMembers }> {
  const targets: Array<{
    groupId: string;
    members: OrganizationGroupMembers;
  }> = [];

  if (
    input.adminGroupId &&
    input.adminMembers &&
    hasDirectUserMember(input.adminMembers, input.disabledUserId)
  ) {
    targets.push({
      groupId: input.adminGroupId,
      members: input.adminMembers,
    });
  }
  if (hasDirectUserMember(input.memberMembers, input.disabledUserId)) {
    targets.push({
      groupId: input.memberGroupId,
      members: input.memberMembers,
    });
  }

  return targets;
}

async function loadRosterDisableMembershipTargets(input: {
  adminGroupId: string | null;
  disabledUserId: string;
  memberGroupId: string;
  orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  setError: Dispatch<SetStateAction<string | null>>;
}): Promise<Array<{
  groupId: string;
  members: OrganizationGroupMembers;
}> | null> {
  const [memberGroupDetails, adminGroupDetails] = await Promise.all([
    input.orgManagerActions.loadGroupDetails(input.memberGroupId),
    input.adminGroupId
      ? input.orgManagerActions.loadGroupDetails(input.adminGroupId)
      : Promise.resolve(null),
  ]);
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
  orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  targets: ReadonlyArray<{
    groupId: string;
    members: OrganizationGroupMembers;
  }>;
}): Promise<void> {
  for (const target of input.targets) {
    await input.orgManagerActions.removeUserFromGroup(
      target.groupId,
      input.disabledUserId,
      remainingGroupUserRecipients({
        directory: input.directory,
        members: target.members,
        removedUserId: input.disabledUserId,
      }),
      input.directory.currentUser.isOrgAdmin,
    );
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
    async (disabledUserId: string) => {
      const targetUser =
        directory?.users.find((user) => user.userId === disabledUserId) ?? null;
      const adminGroupId = findBuiltinAdminGroupId(groups);
      if (
        !canDisableRosterUserRequest({
          authUserId: appData.auth.userId,
          canDisableRosterUsers,
          directory,
          memberGroupId,
          targetUser,
        })
      ) {
        return;
      }
      const disableDirectory = directory;
      const disableMemberGroupId = memberGroupId;
      if (!disableDirectory || !disableMemberGroupId) {
        return;
      }

      setMutating(true);
      setError(null);
      try {
        const mutationTargets = await loadRosterDisableMembershipTargets({
          adminGroupId,
          disabledUserId,
          memberGroupId: disableMemberGroupId,
          orgManagerActions,
          setError,
        });
        if (!mutationTargets) {
          return;
        }

        await removeRosterDisableMembershipTargets({
          directory: disableDirectory,
          disabledUserId,
          orgManagerActions,
          targets: mutationTargets,
        });

        const refreshedDirectory = await refreshDirectoryAndGroups({
          skipNextGroupDetailsEffect: true,
        });
        if (refreshedDirectory.didLoad) {
          await refreshSelectedGroupDetails(refreshedDirectory.groupId);
        }
        await refreshSelectedUserDetail(selectedUserIdRef.current);
      } catch (nextError) {
        setUnknownError(setError, nextError);
      } finally {
        setMutating(false);
      }
    },
    [
      appData.auth.userId,
      canDisableRosterUsers,
      directory,
      groups,
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
