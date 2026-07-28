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
  readonly containerIds?: readonly string[];
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
  const containerIdChunks = scope.containerIds
    ? chunk([...new Set(scope.containerIds)], SCOPE_CHUNK_SIZE)
    : [undefined];
  const scopeChunks = chunk([...scope.userIds], SCOPE_CHUNK_SIZE).flatMap(
    (userIdChunk) =>
      containerIdChunks.map((containerIdChunk) => ({
        containerIdChunk,
        userIdChunk,
      })),
  );
  const rows: TombstoneRow[] = [];
  for (const { containerIdChunk, userIdChunk } of scopeChunks) {
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
            ...(containerIdChunk
              ? [inArray(containerSyncTombstones.containerId, containerIdChunk)]
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
 * Expand a set of container ids to include every local descendant: grants
 * are inherited through container paths, so access regained at an ancestor
 * also invalidates a descendant's own stale tombstone.
 */
export async function expandContainerSubtreeIds(
  executor: DatabaseTransaction,
  rootContainerIds: readonly string[],
): Promise<string[]> {
  const rootIds = [...new Set(rootContainerIds)];
  if (rootIds.length === 0) {
    return [];
  }
  const expanded = new Set<string>(rootIds);
  for (const rootIdChunk of chunk(rootIds, SCOPE_CHUNK_SIZE)) {
    const result = await executor.execute(sql`
      with recursive subtree as (
        select ${containers.id} as id
        from ${containers}
        where ${containers.id} in (${sql.join(
          rootIdChunk.map((rootId) => sql`${rootId}`),
          sql`, `,
        )})
        union all
        select child.id
        from ${containers} child
        inner join subtree on child.parent_id = subtree.id
      )
      select id from subtree
    `);
    for (const row of result.rows) {
      const id = Reflect.get(row, "id");
      if (typeof id === "string") {
        expanded.add(id);
      }
    }
  }
  return [...expanded];
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
 * revocation history), scoped to the caller's knowledge of the event — the
 * affected candidate `containerIds` for a policy transition, the event's
 * `organizationId` for a container grant — with one batched access
 * resolution per user and chunked conditional deletes.
 */
export async function pruneRegainedAccessTombstones(input: {
  readonly containerIds?: readonly string[];
  readonly executor: DatabaseTransaction;
  readonly organizationId?: string;
  readonly userIds: readonly string[];
}): Promise<void> {
  const userIds = [...new Set(input.userIds)];
  if (userIds.length === 0 || input.containerIds?.length === 0) {
    return;
  }

  const rows = await selectScopedTombstoneRows(input.executor, {
    ...(input.containerIds ? { containerIds: input.containerIds } : {}),
    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    userIds,
  });
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
