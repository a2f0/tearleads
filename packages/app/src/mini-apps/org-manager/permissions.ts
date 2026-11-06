import type {
  OrganizationDirectory,
  OrganizationDirectoryUser,
} from "@tearleads/client-sdk";

// A roster user can be disabled when disabling is available at all and the
// target is an active user other than the operator or personal-org owner.
export function canDisableRosterUser(input: {
  authUserId: string | null;
  canDisableRosterUsers: boolean;
  targetUser: Pick<
    OrganizationDirectoryUser,
    "isPersonalOrganizationOwner" | "isSelf" | "status" | "userId"
  > | null;
}): boolean {
  const { authUserId, canDisableRosterUsers, targetUser } = input;

  return Boolean(
    canDisableRosterUsers &&
      targetUser &&
      targetUser.status === "active" &&
      !targetUser.isPersonalOrganizationOwner &&
      !targetUser.isSelf &&
      targetUser.userId !== authUserId,
  );
}

// The API accepts group policy changes only from organization admins (members
// of the built-in Admins group); a direct admin of one group is not enough.
export function canCurrentUserMutateSelectedGroup(
  directory: OrganizationDirectory | null,
): boolean {
  return directory?.currentUser.isOrgAdmin ?? false;
}
