import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { sql } from "drizzle-orm";
import { notePrincipalMutationLocked } from "../../access/write/principalStateStore";
import { isSqliteApiDatabase } from "../../utils/sqlDialect";
import {
  acquireTransactionLock,
  advisoryLockKey,
} from "../../utils/transactionLocks";

type LockablePrincipalType = "group" | "organization";

/**
 * Serialize principal writes and organization-scope association by type + UUID.
 * SQLite transactions already begin immediate; Postgres uses a transaction-
 * scoped advisory lock derived from a collision-resistant full-ID digest.
 * Once held, the transaction may reuse its current-state and organization
 * descriptor reads for that principal (`notePrincipalMutationLocked`).
 */
export async function lockPrincipalMutationInTransaction(
  tx: DatabaseTransaction,
  principalType: LockablePrincipalType,
  principalId: string,
): Promise<void> {
  const keys = await derivePrincipalMutationLockKeys(
    principalType,
    principalId,
  );
  const [firstKey, secondKey] = keys;
  if (!isSqliteApiDatabase()) {
    await acquireTransactionLock(tx, advisoryLockKey(keys), "exclusive", () =>
      tx.execute(sql`select pg_advisory_xact_lock(${firstKey}, ${secondKey})`),
    );
  }
  notePrincipalMutationLocked(tx, principalType, principalId);
}

export async function lockOrganizationGroupMutationInTransaction(
  tx: DatabaseTransaction,
  organizationId: string,
  groupId: string,
): Promise<void> {
  await lockPrincipalMutationInTransaction(tx, "organization", organizationId);
  await lockPrincipalMutationInTransaction(tx, "group", groupId);
}

export async function derivePrincipalMutationLockKeys(
  principalType: LockablePrincipalType,
  principalId: string,
): Promise<readonly [number, number]> {
  const normalizedId = principalId.replaceAll("-", "");
  if (!/^[\da-f]{32}$/iu.test(normalizedId)) {
    throw new Error("Principal id is not a UUID");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${principalType}:${normalizedId.toLowerCase()}`),
  );
  const lockKeys = new DataView(digest);
  return [lockKeys.getInt32(0, false), lockKeys.getInt32(4, false)];
}
