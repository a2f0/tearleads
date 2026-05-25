import type {
  OrganizationDirectory,
  OrganizationDirectoryUser,
  OrganizationGroupMember,
  OrganizationGroupMembers,
  OrganizationUserRecipient,
} from "@tearleads/client-sdk";

export function userRecipient(
  user: OrganizationDirectoryUser,
): OrganizationUserRecipient {
  return {
    userId: user.userId,
    encapsulationPublicKey: user.encapsulationPublicKey,
    encapsulationKeyFingerprint: user.encapsulationKeyFingerprint,
  };
}

function memberUserRecipient(
  member: OrganizationGroupMember,
): OrganizationUserRecipient | null {
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
  directory: OrganizationDirectory;
  members: OrganizationGroupMembers | null;
}): OrganizationUserRecipient[] {
  const recipientsById = new Map<string, OrganizationUserRecipient>();

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
