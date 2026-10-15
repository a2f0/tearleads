import type {
  OrganizationDirectory,
  ResolvedUserIdentity,
  UserIdentities,
} from "@tearleads/client-sdk";

export async function resolveGroupIdentity(input: {
  directoryUser: OrganizationDirectory["users"][number] | undefined;
  value: string;
  verifyLink: UserIdentities["verifyLink"];
  resolvePinned: (userId: string) => Promise<ResolvedUserIdentity | null>;
}): Promise<{ userId: string }> {
  if (!input.directoryUser) return input.verifyLink(input.value);
  const pinned = await input.resolvePinned(input.directoryUser.userId);
  if (!pinned)
    throw new Error(
      "Ask this person for their identity link before adding them.",
    );
  return pinned;
}
