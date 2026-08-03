import type {
  OrganizationDirectory,
  OrganizationGroupMembers,
} from "@tearleads/client-sdk";

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
