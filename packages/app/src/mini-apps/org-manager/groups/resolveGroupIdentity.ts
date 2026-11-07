import type {
  OrganizationDirectory,
  ResolvedUserIdentity,
  UserIdentities,
} from "@tearleads/client-sdk";

// Adding a group member admits them. A raw directory selection works only when
// a verified identity link (or this device's keys) already established that
// user; otherwise the field must hold their identity link.
export async function resolveGroupIdentity(input: {
  directoryUser: OrganizationDirectory["users"][number] | undefined;
  value: string;
  verifyLink: UserIdentities["verifyLink"];
  resolveVerified: (userId: string) => Promise<ResolvedUserIdentity | null>;
}): Promise<{ userId: string }> {
  if (!input.directoryUser) return input.verifyLink(input.value);
  const verified = await input.resolveVerified(input.directoryUser.userId);
  if (!verified)
    throw new Error(
      "Ask this person for their identity link before adding them.",
    );
  return verified;
}
