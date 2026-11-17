import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { blobs } from "@tearleads/api-shared/schema";
import { compareCanonicalStrings } from "@tearleads/crypto";
import { asc, inArray } from "drizzle-orm";

/**
 * Unique ids in code-unit order, which for canonical lowercase UUIDs is the
 * database's UUID order, so consecutive slices of the plan lock in one global
 * order.
 */
export function planBlobMutationLockIds(blobIds: readonly string[]): string[] {
  return [...new Set(blobIds)].sort(compareCanonicalStrings);
}

/**
 * Blob attachment mutations lock every involved existing blob before changing
 * a binding. The UUID order is shared by bind, replacement, detach, purges, and
 * the reclaim sweep, so two transactions cannot form a blob-row lock cycle.
 */
export async function lockBlobMutationRows(input: {
  readonly blobIds: readonly string[];
  readonly executor: DatabaseTransaction;
}): Promise<void> {
  const blobIds = planBlobMutationLockIds(input.blobIds);
  if (blobIds.length === 0) {
    return;
  }

  const query = input.executor
    .select({ id: blobs.id })
    .from(blobs)
    .where(inArray(blobs.id, blobIds))
    .orderBy(asc(blobs.id));
  await query.for("update");
}
