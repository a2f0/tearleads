import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { containerSyncTombstones } from "@tearleads/api-shared/schema";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  KeyingReadAccessError,
  resolveReadableContainerAccessBatch,
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
 *
 * Workload is bounded by the gained users' own tombstone rows (their
 * revocation history), scoped to `organizationId` when the caller knows the
 * event's organization, with one batched access resolution per user and a
 * single conditional delete.
 */
export async function pruneRegainedAccessTombstones(input: {
  readonly executor: DatabaseTransaction;
  readonly organizationId?: string;
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
      updatedAt: containerSyncTombstones.updatedAt,
      userId: containerSyncTombstones.userId,
    })
    .from(containerSyncTombstones)
    .where(
      and(
        inArray(containerSyncTombstones.userId, userIds),
        eq(containerSyncTombstones.reason, "access_revoked"),
        ...(input.organizationId
          ? [eq(containerSyncTombstones.organizationId, input.organizationId)]
          : []),
      ),
    );
  if (rows.length === 0) {
    return;
  }

  const rowsByUserId = new Map<string, typeof rows>();
  for (const row of rows) {
    const userRows = rowsByUserId.get(row.userId) ?? [];
    userRows.push(row);
    rowsByUserId.set(row.userId, userRows);
  }

  const prunableRows: typeof rows = [];
  for (const [userId, userRows] of rowsByUserId) {
    const results = await resolveReadableContainerAccessBatch({
      containerIds: userRows.map((row) => row.containerId),
      executor: input.executor,
      userId,
    });
    for (const row of userRows) {
      const result = results.get(row.containerId);
      if (result?.status === "fulfilled") {
        prunableRows.push(row);
        continue;
      }
      const reason = result?.reason;
      if (
        reason instanceof KeyingReadAccessError &&
        (reason.status === 403 ||
          reason.status === 404 ||
          reason.status === 409)
      ) {
        continue;
      }
      if (reason) {
        throw reason;
      }
    }
  }
  if (prunableRows.length === 0) {
    return;
  }

  // Tombstones are upserted in place (same row id, new reason/timestamp), so
  // a delete by id alone could erase a tombstone a concurrent revoke or
  // delete refreshed between the select and this statement. Conditioning on
  // the reason and timestamp we validated makes the concurrent write win.
  await input.executor
    .delete(containerSyncTombstones)
    .where(
      or(
        ...prunableRows.map((row) =>
          and(
            eq(containerSyncTombstones.id, row.id),
            eq(containerSyncTombstones.reason, "access_revoked"),
            eq(containerSyncTombstones.updatedAt, row.updatedAt),
          ),
        ),
      ),
    );
}
