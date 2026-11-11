import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { inArray } from "drizzle-orm";

/** One set read for the entire policy, never a query per member. */
export async function listRegisteredUserIdentityKeys(
  executor: DatabaseSession,
  userIds: readonly string[],
) {
  if (userIds.length === 0) return [];
  return executor
    .select({
      userId: users.id,
      signingPublicKey: users.signingPublicKey,
      encapsulationPublicKey: users.encapsulationPublicKey,
      signingKeyFingerprint: users.fingerprint,
      encapsulationKeyFingerprint: users.encapsulationKeyFingerprint,
    })
    .from(users)
    .where(inArray(users.id, [...new Set(userIds)]));
}
