import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  containerSyncTombstones,
  containers,
} from "@tearleads/api-shared/schema";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  KeyingReadAccessError,
  resolveReadableContainerAccessBatch,
} from "./keyingReadAccess";

const DELETE_CHUNK_SIZE = 500;
const SCOPE_CHUNK_SIZE = 1000;

interface TombstoneRow {
  readonly containerId: string;
  readonly id: string;
  readonly updatedAt: Date;
  readonly userId: string;
}

interface PruneScope {
  readonly organizationId?: string;
  readonly userIds: readonly string[];
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function selectScopedTombstoneRows(
  executor: DatabaseTransaction,
  scope: PruneScope,
): Promise<TombstoneRow[]> {
  const rows: TombstoneRow[] = [];
  for (const userIdChunk of chunk([...scope.userIds], SCOPE_CHUNK_SIZE)) {
    rows.push(
      ...(await executor
        .select({
          containerId: containerSyncTombstones.containerId,
          id: containerSyncTombstones.id,
          updatedAt: containerSyncTombstones.updatedAt,
          userId: containerSyncTombstones.userId,
        })
        .from(containerSyncTombstones)
        .where(
          and(
            inArray(containerSyncTombstones.userId, userIdChunk),
            eq(containerSyncTombstones.reason, "access_revoked"),
            ...(scope.organizationId
              ? [
                  eq(
                    containerSyncTombstones.organizationId,
                    scope.organizationId,
                  ),
                ]
              : []),
          ),
        )),
    );
  }
  return rows;
}

function keepRowForResult(reason: unknown): boolean {
  if (
    reason instanceof KeyingReadAccessError &&
    (reason.status === 403 || reason.status === 404 || reason.status === 409)
  ) {
    return true;
  }
  if (reason) {
    throw reason;
  }
  return true;
}

async function filterReadableRows(
  executor: DatabaseTransaction,
  rows: readonly TombstoneRow[],
): Promise<TombstoneRow[]> {
  const rowsByUserId = new Map<string, TombstoneRow[]>();
  for (const row of rows) {
    const userRows = rowsByUserId.get(row.userId) ?? [];
    userRows.push(row);
    rowsByUserId.set(row.userId, userRows);
  }

  const prunableRows: TombstoneRow[] = [];
  for (const [userId, userRows] of rowsByUserId) {
    const results = await resolveReadableContainerAccessBatch({
      containerIds: userRows.map((row) => row.containerId),
      executor,
      userId,
    });
    for (const row of userRows) {
      const result = results.get(row.containerId);
      if (result?.status === "fulfilled") {
        prunableRows.push(row);
        continue;
      }
      keepRowForResult(result?.reason);
    }
  }
  return prunableRows;
}

/**
 * Filter tombstone rows to those whose container lies inside one of the
 * given subtrees, walking each candidate's ancestry UPWARD. Grants inherit
 * through container paths, so access regained at an ancestor also
 * invalidates a descendant's own stale tombstone — but the candidate set is
 * the users' tombstones (bounded by revocation history), never a
 * materialized subtree, so a root-level grant stays cheap.
 */
async function filterRowsWithinSubtrees(
  executor: DatabaseTransaction,
  rows: readonly TombstoneRow[],
  rootContainerIds: readonly string[],
): Promise<TombstoneRow[]> {
  const rootIds = new Set(rootContainerIds);
  if (rootIds.size === 0) {
    return [];
  }
  const candidateIds = [...new Set(rows.map((row) => row.containerId))];
  const memberIds = new Set<string>();
  for (const candidateChunk of chunk(candidateIds, SCOPE_CHUNK_SIZE)) {
    const result = await executor.execute(sql`
      with recursive ancestry as (
        select ${containers.id} as container_id, ${containers.id} as ancestor_id,
               ${containers.parentId} as parent_id
        from ${containers}
        where ${containers.id} in (${sql.join(
          candidateChunk.map((candidateId) => sql`${candidateId}`),
          sql`, `,
        )})
        union all
        select ancestry.container_id, parent.id, parent.parent_id
        from ${containers} parent
        inner join ancestry on parent.id = ancestry.parent_id
      )
      select distinct container_id, ancestor_id from ancestry
    `);
    for (const row of result.rows) {
      const containerId = Reflect.get(row, "container_id");
      const ancestorId = Reflect.get(row, "ancestor_id");
      if (
        typeof containerId === "string" &&
        typeof ancestorId === "string" &&
        rootIds.has(ancestorId)
      ) {
        memberIds.add(containerId);
      }
    }
  }
  return rows.filter((row) => memberIds.has(row.containerId));
}

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
 * revocation history), selected FIRST and then intersected with the
 * affected subtrees — the grant roots a policy transition or container
 * grant can restore — with one batched access resolution per user and
 * chunked conditional deletes.
 */
export async function pruneRegainedAccessTombstones(input: {
  readonly executor: DatabaseTransaction;
  readonly organizationId?: string;
  readonly userIds: readonly string[];
  readonly withinSubtreesOf?: readonly string[];
}): Promise<void> {
  const userIds = [...new Set(input.userIds)];
  if (userIds.length === 0 || input.withinSubtreesOf?.length === 0) {
    return;
  }

  const scopedRows = await selectScopedTombstoneRows(input.executor, {
    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    userIds,
  });
  const rows = input.withinSubtreesOf
    ? await filterRowsWithinSubtrees(
        input.executor,
        scopedRows,
        input.withinSubtreesOf,
      )
    : scopedRows;
  if (rows.length === 0) {
    return;
  }

  const prunableRows = await filterReadableRows(input.executor, rows);

  // Tombstones are upserted in place (same row id, new reason/timestamp), so
  // a delete by id alone could erase a tombstone a concurrent revoke or
  // delete refreshed between the select and this statement. Conditioning on
  // the reason and timestamp we validated makes the concurrent write win.
  // Chunked so the OR can never approach PostgreSQL's parameter limits.
  for (const deleteChunk of chunk(prunableRows, DELETE_CHUNK_SIZE)) {
    await input.executor
      .delete(containerSyncTombstones)
      .where(
        or(
          ...deleteChunk.map((row) =>
            and(
              eq(containerSyncTombstones.id, row.id),
              eq(containerSyncTombstones.reason, "access_revoked"),
              eq(containerSyncTombstones.updatedAt, row.updatedAt),
            ),
          ),
        ),
      );
  }
}
