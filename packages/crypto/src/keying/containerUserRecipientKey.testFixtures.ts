import type { ContainerUserRecipientKey } from "./containerKekTypes";
import { fixtureHash } from "./testFixtures";

export async function createContainerUserRecipientKey(
  userId: string,
): Promise<ContainerUserRecipientKey> {
  const fingerprint = await fixtureHash(`${userId}-key`);
  return {
    userId,
    recipientKeyEpochId: `user:${userId}:encapsulation:${fingerprint}`,
    recipientKeyFingerprint: fingerprint,
  };
}
