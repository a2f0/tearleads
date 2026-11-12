import type {
  OrganizationDirectory,
  ResolvedUserIdentity,
  UserIdentities,
} from "@tearleads/client-sdk";

// An active directory row selects a candidate, not trusted identity keys.
// The SDK authenticates that candidate against signed Members history before
// adding them. New or disabled members still need direct self/link admission.
export async function resolveGroupIdentity(input: {
  directoryUser: OrganizationDirectory["users"][number] | undefined;
  value: string;
  verifyLink: UserIdentities["verifyLink"];
  resolveVerified: (userId: string) => Promise<ResolvedUserIdentity | null>;
}): Promise<{ userId: string }> {
  if (!input.directoryUser) return input.verifyLink(input.value);
  if (input.directoryUser.status === "active") {
    return { userId: input.directoryUser.userId };
  }
  const verified = await input.resolveVerified(input.directoryUser.userId);
  if (!verified)
    throw new Error(
      "Ask this person for their identity link before adding them.",
    );
  return verified;
}
