import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { groups } from "@tearleads/api-shared/schema";
import { inArray, sql } from "drizzle-orm";
import { uniqueSortedStrings } from "../../utils/array";
import { isSqliteApiDatabase } from "../../utils/sqlDialect";
import {
  acquireTransactionLock,
  advisoryLockKey,
} from "../../utils/transactionLocks";

export function sortGroupReferenceIds(groupIds: readonly string[]): string[] {
  return uniqueSortedStrings(groupIds);
}

async function deriveLockKeys(
  scope: string,
): Promise<readonly [number, number]> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(scope),
  );
  const lockKeys = new DataView(digest);
  return [lockKeys.getInt32(0, false), lockKeys.getInt32(4, false)];
}

export async function deriveGroupReferenceLockKeys(
  groupId: string,
): Promise<readonly [number, number]> {
  const normalizedId = groupId.replaceAll("-", "");
  if (!/^[\da-f]{32}$/iu.test(normalizedId)) {
    throw new Error("Group reference id is not a UUID");
  }
  return deriveLockKeys(`group-reference:${normalizedId.toLowerCase()}`);
}

export async function lockGroupPolicyRematerializationInTransaction(
  tx: DatabaseTransaction,
): Promise<void> {
  if (isSqliteApiDatabase()) return;
  const keys = await deriveLockKeys("group-reference:policy-rematerialization");
  const [firstKey, secondKey] = keys;
  await acquireTransactionLock(tx, advisoryLockKey(keys), "exclusive", () =>
    tx.execute(sql`select pg_advisory_xact_lock(${firstKey}, ${secondKey})`),
  );
}

async function lockGroupReferenceInTransaction(
  tx: DatabaseTransaction,
  groupId: string,
  mode: "exclusive" | "shared",
): Promise<void> {
  const keys = await deriveGroupReferenceLockKeys(groupId);
  const [firstKey, secondKey] = keys;
  if (isSqliteApiDatabase()) return;
  await acquireTransactionLock(tx, advisoryLockKey(keys), mode, () =>
    mode === "shared"
      ? tx.execute(
          sql`select pg_advisory_xact_lock_shared(${firstKey}, ${secondKey})`,
        )
      : tx.execute(
          sql`select pg_advisory_xact_lock(${firstKey}, ${secondKey})`,
        ),
  );
}

export async function lockGroupReferenceExclusiveInTransaction(
  tx: DatabaseTransaction,
  groupId: string,
): Promise<void> {
  await lockGroupReferenceInTransaction(tx, groupId, "exclusive");
}

export async function lockAndFindMissingGroupReferencesInTransaction(
  tx: DatabaseTransaction,
  groupIds: readonly string[],
): Promise<string[]> {
  const sortedGroupIds = sortGroupReferenceIds(groupIds);
  const nonCanonicalGroupIds = sortedGroupIds.filter(
    (groupId) => groupId !== groupId.toLowerCase(),
  );
  if (nonCanonicalGroupIds.length > 0) {
    return nonCanonicalGroupIds;
  }
  for (const groupId of sortedGroupIds) {
    await lockGroupReferenceInTransaction(tx, groupId, "shared");
  }
  if (sortedGroupIds.length === 0) {
    return [];
  }

  const existingRows = await tx
    .select({ groupId: groups.id })
    .from(groups)
    .where(inArray(groups.id, sortedGroupIds));
  const existingGroupIds = new Set(existingRows.map((row) => row.groupId));
  return sortedGroupIds.filter((groupId) => !existingGroupIds.has(groupId));
}
