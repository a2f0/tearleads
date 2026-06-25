import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { type AccountStatus, users } from "@tearleads/api-shared/schema";
import { inArray } from "drizzle-orm";

export interface UserKeyRow {
  accountStatus: AccountStatus;
  userId: string;
  signingKeyFingerprint: string;
  signingPublicKey: string;
  encapsulationPublicKey: string;
  encapsulationKeyFingerprint: string;
  createdAt: Date;
}

export async function loadUsersById(
  executor: DatabaseSession,
  userIds: readonly string[],
): Promise<Map<string, UserKeyRow>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const rows = await executor
    .select({
      accountStatus: users.accountStatus,
      userId: users.id,
      signingKeyFingerprint: users.fingerprint,
      signingPublicKey: users.signingPublicKey,
      encapsulationPublicKey: users.encapsulationPublicKey,
      encapsulationKeyFingerprint: users.encapsulationKeyFingerprint,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(inArray(users.id, [...userIds]));

  return new Map(rows.map((row) => [row.userId, row]));
}
