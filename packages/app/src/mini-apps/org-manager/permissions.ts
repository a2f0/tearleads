import type {
  OrganizationDirectory,
  OrganizationDirectoryUser,
  OrganizationGroupMembers,
} from "@tearleads/client-sdk";

// A roster user can be disabled when disabling is available at all and the
// target is an active user other than the operator themselves.
export function canDisableRosterUser(input: {
  authUserId: string | null;
  canDisableRosterUsers: boolean;
  targetUser: Pick<
    OrganizationDirectoryUser,
    "isSelf" | "status" | "userId"
  > | null;
}): boolean {
  const { authUserId, canDisableRosterUsers, targetUser } = input;

  return Boolean(
    canDisableRosterUsers &&
      targetUser &&
      targetUser.status === "active" &&
      !targetUser.isSelf &&
      targetUser.userId !== authUserId,
  );
}

export function canCurrentUserMutateSelectedGroup(input: {
  directory: OrganizationDirectory | null;
  members: OrganizationGroupMembers | null;
  userId: string | null;
}): boolean {
  if (input.directory?.currentUser.isOrgAdmin) {
    return true;
  }

  return (
    input.members?.members.some(
      (member) => member.userId === input.userId && member.role === "admin",
    ) ?? false
  );
}
