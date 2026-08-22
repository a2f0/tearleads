import type { DatabaseTransaction } from "@symcrypt/api-shared/postgres";
import { blobs } from "@symcrypt/api-shared/schema";
import { asc, inArray } from "drizzle-orm";
import { lockRowForUpdate } from "../../../utils/sqlDialect";

export function planBlobMutationLockIds(blobIds: readonly string[]): string[] {
  return [...new Set(blobIds)].sort((left, right) => left.localeCompare(right));
}

/**
 * Blob attachment mutations lock every involved existing blob before changing
 * a binding. The UUID order is shared by bind, replacement, and detach, so two
 * transactions cannot form a blob-row/binding-row lock cycle.
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
  await lockRowForUpdate(query);
}
