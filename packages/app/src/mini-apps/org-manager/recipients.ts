import type {
  OrgManagerDirectory,
  OrgManagerDirectoryUser,
  OrgManagerGroupMember,
  OrgManagerGroupMembers,
  OrgManagerUserRecipient,
} from "../../stores/org-manager/OrgManagerProvider";

export function userRecipient(
  user: OrgManagerDirectoryUser,
): OrgManagerUserRecipient {
  return {
    userId: user.userId,
    encapsulationPublicKey: user.encapsulationPublicKey,
    encapsulationKeyFingerprint: user.encapsulationKeyFingerprint,
  };
}

function memberUserRecipient(
  member: OrgManagerGroupMember,
): OrgManagerUserRecipient | null {
  if (
    member.memberPrincipalType !== "user" ||
    !member.encapsulationPublicKey ||
    !member.encapsulationKeyFingerprint
  ) {
    return null;
  }

  return {
    userId: member.memberPrincipalId,
    encapsulationPublicKey: member.encapsulationPublicKey,
    encapsulationKeyFingerprint: member.encapsulationKeyFingerprint,
  };
}

export function currentGroupUserRecipients(input: {
  directory: OrgManagerDirectory;
  members: OrgManagerGroupMembers | null;
}): OrgManagerUserRecipient[] {
  const recipientsById = new Map<string, OrgManagerUserRecipient>();

  for (const user of input.directory.users) {
    const recipient = userRecipient(user);
    recipientsById.set(recipient.userId, recipient);
  }

  for (const member of input.members?.members ?? []) {
    const recipient = memberUserRecipient(member);
    if (recipient) {
      recipientsById.set(recipient.userId, recipient);
    }
  }

  return [...recipientsById.values()];
}
