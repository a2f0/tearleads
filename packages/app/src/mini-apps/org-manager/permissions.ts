import type {
  OrgManagerDirectory,
  OrgManagerGroupMembers,
} from "../../stores/org-manager/OrgManagerProvider";

export function canCurrentUserMutateSelectedGroup(input: {
  directory: OrgManagerDirectory | null;
  members: OrgManagerGroupMembers | null;
  userId: string | null;
}): boolean {
  if (input.directory?.currentUser.isOrgAdmin) {
    return true;
  }

  return (
    input.members?.members.some(
      (member) =>
        member.memberPrincipalType === "user" &&
        member.memberPrincipalId === input.userId &&
        member.role === "admin",
    ) ?? false
  );
}
