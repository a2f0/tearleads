import type {
  PgQueryable,
  ReplicaWriteIdRow
} from './vfsCrdtSnapshotCommon.js';

const CRDT_CLIENT_PUSH_SOURCE_TABLE = 'vfs_crdt_client_push';
const REPLICA_HEADS_READ_FLAG = 'VFS_CRDT_REPLICA_HEADS_READS';

function parseReplicaHeadsReadFlag(rawValue: string | undefined): boolean {
  if (rawValue === undefined) {
    return true;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on'
  ) {
    return true;
  }

  if (
    normalized === '0' ||
    normalized === 'false' ||
    normalized === 'no' ||
    normalized === 'off'
  ) {
    return false;
  }

  // Fail-open to table reads unless explicitly disabled.
  return true;
}

export function areReplicaHeadReadsEnabled(): boolean {
  return parseReplicaHeadsReadFlag(process.env[REPLICA_HEADS_READ_FLAG]);
}

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

async function loadReplicaWriteIdsFromLegacyOps(
  client: PgQueryable,
  userId: string
): Promise<ReplicaWriteIdRow[]> {
  const result = await client.query<ReplicaWriteIdRow>(
    `
    SELECT
      split_part(source_id, ':', 2) AS replica_id,
      MAX(
        CASE
          WHEN split_part(source_id, ':', 3) ~ '^[0-9]+$'
            AND (
              length(split_part(source_id, ':', 3)) < 19
              OR (
                length(split_part(source_id, ':', 3)) = 19
                AND split_part(source_id, ':', 3) <= '9223372036854775807'
              )
            )
            THEN split_part(source_id, ':', 3)::bigint
          ELSE NULL
        END
      ) AS max_write_id
    FROM vfs_crdt_ops
    WHERE source_table = $1::text
      AND actor_id = $2::text
    GROUP BY split_part(source_id, ':', 2)
    `,
    [CRDT_CLIENT_PUSH_SOURCE_TABLE, userId]
  );
  return result.rows;
}

export async function loadReplicaWriteIdRows(
  client: PgQueryable,
  userId: string
): Promise<ReplicaWriteIdRow[]> {
  if (areReplicaHeadReadsEnabled()) {
    return loadReplicaWriteIdsFromReplicaHeads(client, userId);
  }
  return loadReplicaWriteIdsFromLegacyOps(client, userId);
}
