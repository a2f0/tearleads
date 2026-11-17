import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { inArray } from "drizzle-orm";

/**
 * A user's directory facts: key fingerprints only. Clients take public keys
 * from their trusted identity store, never from an organization read.
 */
export interface UserDirectoryRow {
  userId: string;
  defaultOrganizationId: string;
  signingKeyFingerprint: string;
  encapsulationKeyFingerprint: string;
  createdAt: Date;
}

export type UserSigningFingerprintRow = Pick<
  UserDirectoryRow,
  "userId" | "signingKeyFingerprint"
>;

export async function loadUserSigningFingerprints(
  executor: DatabaseSession,
  userIds: readonly string[],
): Promise<Map<string, UserSigningFingerprintRow>> {
  if (userIds.length === 0) return new Map();
  const rows = await executor
    .select({
      userId: users.id,
      signingKeyFingerprint: users.fingerprint,
    })
    .from(users)
    .where(inArray(users.id, [...userIds]));
  return new Map(rows.map((row) => [row.userId, row]));
}

export async function loadUsersById(
  executor: DatabaseSession,
  userIds: readonly string[],
): Promise<Map<string, UserDirectoryRow>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const rows = await executor
    .select({
      userId: users.id,
      defaultOrganizationId: users.defaultOrganizationId,
      signingKeyFingerprint: users.fingerprint,
      encapsulationKeyFingerprint: users.encapsulationKeyFingerprint,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(inArray(users.id, [...userIds]));

  return new Map(rows.map((row) => [row.userId, row]));
}
