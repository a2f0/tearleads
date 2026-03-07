import {
  invalidateReplicaWriteIdRowsCache,
  readReplicaWriteIdRowsCache,
  writeReplicaWriteIdRowsCache
} from './vfsCrdtRedisCache.js';
import type {
  PgQueryable,
  ReplicaWriteIdRow
} from './vfsCrdtSnapshotCommon.js';

async function loadReplicaWriteIdsFromReplicaHeads(
  client: PgQueryable,
  userId: string
): Promise<ReplicaWriteIdRow[]> {
  const result = await client.query<ReplicaWriteIdRow>(
    `
    SELECT
      replica_id,
      max_write_id
    FROM vfs_crdt_replica_heads
    WHERE actor_id = $1::text
    `,
    [userId]
  );
  return result.rows;
}

export async function loadReplicaWriteIdRows(
  client: PgQueryable,
  userId: string
): Promise<ReplicaWriteIdRow[]> {
  const cachedRows = await readReplicaWriteIdRowsCache({ userId });
  if (cachedRows !== undefined) {
    return cachedRows;
  }

  const rows = await loadReplicaWriteIdsFromReplicaHeads(client, userId);
  await writeReplicaWriteIdRowsCache({
    userId,
    rows
  });
  return rows;
}

export async function invalidateReplicaWriteIdRowsForUser(
  userId: string
): Promise<void> {
  await invalidateReplicaWriteIdRowsCache(userId);
}
