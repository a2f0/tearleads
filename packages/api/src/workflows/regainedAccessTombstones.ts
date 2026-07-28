import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { containerSyncTombstones } from "@tearleads/api-shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  KeyingReadAccessError,
  resolveReadableContainerAccess,
} from "./keyingReadAccess";

/**
 * Delete the `access_revoked` container sync tombstones that a user's
 * regained access has made stale. Tombstone rows are upserted on access loss
 * and served alongside lane items forever after; a restore that advances no
 * container timestamp (a group re-add, a policy change) otherwise leaves the
 * stale row winning the client's page-level last-writer filter, hiding the
 * restored container indefinitely.
 *
 * Precision matters in both directions: only rows whose container the user
 * can NOW read are deleted — an undelivered tombstone for a container the
 * user did not regain must survive, or a client that never synced during the
 * revoke window would keep a permanent local ghost. `deleted` tombstones are
 * never pruned: deletion is terminal and container ids are not reused.
 */
export async function pruneRegainedAccessTombstones(input: {
  readonly executor: DatabaseTransaction;
  readonly userIds: readonly string[];
}): Promise<void> {
  const userIds = [...new Set(input.userIds)];
  if (userIds.length === 0) {
    return;
  }

  const rows = await input.executor
    .select({
      containerId: containerSyncTombstones.containerId,
      id: containerSyncTombstones.id,
      userId: containerSyncTombstones.userId,
    })
    .from(containerSyncTombstones)
    .where(
      and(
        inArray(containerSyncTombstones.userId, userIds),
        eq(containerSyncTombstones.reason, "access_revoked"),
      ),
    );
  if (rows.length === 0) {
    return;
  }

  const prunableIds: string[] = [];
  for (const row of rows) {
    try {
      await resolveReadableContainerAccess({
        containerId: row.containerId,
        executor: input.executor,
        userId: row.userId,
      });
      prunableIds.push(row.id);
    } catch (error) {
      if (
        error instanceof KeyingReadAccessError &&
        (error.status === 403 || error.status === 404 || error.status === 409)
      ) {
        continue;
      }
      throw error;
    }
  }
  if (prunableIds.length === 0) {
    return;
  }

  await input.executor
    .delete(containerSyncTombstones)
    .where(inArray(containerSyncTombstones.id, prunableIds));
}
