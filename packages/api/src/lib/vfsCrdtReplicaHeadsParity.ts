import { parseOccurredAt, type PgQueryable } from './vfsCrdtSnapshotCommon.js';

const CRDT_CLIENT_PUSH_SOURCE_TABLE = 'vfs_crdt_client_push';
export const DEFAULT_VFS_CRDT_REPLICA_HEADS_PARITY_SAMPLE_LIMIT = 100;

export type VfsCrdtReplicaHeadsParityMismatchReason =
  | 'missing_head'
  | 'stale_head'
  | 'write_id'
  | 'occurred_at'
  | 'write_id_and_occurred_at'
  | 'unknown';

export interface VfsCrdtReplicaHeadsParityMismatch {
  actorId: string | null;
  replicaId: string | null;
  expectedMaxWriteId: string | null;
  actualMaxWriteId: string | null;
  expectedMaxOccurredAt: string | null;
  actualMaxOccurredAt: string | null;
  reason: VfsCrdtReplicaHeadsParityMismatchReason;
}

export interface VfsCrdtReplicaHeadsParityResult {
  checkedPairCount: number;
  mismatchCount: number;
  missingHeadCount: number;
  staleHeadCount: number;
  writeIdMismatchCount: number;
  occurredAtMismatchCount: number;
  sampleLimit: number;
  sampledMismatchCount: number;
  mismatches: VfsCrdtReplicaHeadsParityMismatch[];
}

interface VfsCrdtReplicaHeadsParityCountsRow {
  checked_pair_count: number | string | null;
  mismatch_count: number | string | null;
  missing_head_count: number | string | null;
  stale_head_count: number | string | null;
  write_id_mismatch_count: number | string | null;
  occurred_at_mismatch_count: number | string | null;
}

interface VfsCrdtReplicaHeadsParityMismatchRow {
  actor_id: string | null;
  replica_id: string | null;
  expected_max_write_id: string | number | null;
  actual_max_write_id: string | number | null;
  expected_max_occurred_at: Date | string | null;
  actual_max_occurred_at: Date | string | null;
}

const PARITY_COMPARISON_CTE = `
WITH expected AS (
  SELECT
    actor_id,
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
    ) AS max_write_id,
    MAX(occurred_at) AS max_occurred_at
  FROM vfs_crdt_ops
  WHERE source_table = $1::text
  GROUP BY actor_id, split_part(source_id, ':', 2)
),
joined AS (
  SELECT
    COALESCE(expected.actor_id, heads.actor_id) AS actor_id,
    COALESCE(expected.replica_id, heads.replica_id) AS replica_id,
    expected.max_write_id::text AS expected_max_write_id,
    heads.max_write_id::text AS actual_max_write_id,
    expected.max_occurred_at AS expected_max_occurred_at,
    heads.max_occurred_at AS actual_max_occurred_at
  FROM expected
  FULL OUTER JOIN vfs_crdt_replica_heads AS heads
    ON expected.actor_id = heads.actor_id
   AND expected.replica_id = heads.replica_id
)
`;

const PARITY_MISMATCH_PREDICATE = `
  expected_max_write_id IS DISTINCT FROM actual_max_write_id
  OR expected_max_occurred_at IS DISTINCT FROM actual_max_occurred_at
`;

function parseSampleLimit(rawValue: number): number {
  if (!Number.isInteger(rawValue) || rawValue < 0) {
    throw new Error('sampleLimit must be a non-negative integer');
  }
  return rawValue;
}

function toNonNegativeInteger(
  value: number | string | null | undefined
): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      return 0;
    }
    return Math.trunc(value);
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return 0;
}

function toNullableString(value: string | number | null): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    return String(Math.trunc(value));
  }
  if (typeof value === 'string') {
    return value;
  }

  return null;
}

function isDistinct(left: string | null, right: string | null): boolean {
  if (left === null) {
    return right !== null;
  }
  if (right === null) {
    return true;
  }

  return left !== right;
}

function resolveMismatchReason(
  expectedMaxWriteId: string | null,
  actualMaxWriteId: string | null,
  expectedMaxOccurredAt: string | null,
  actualMaxOccurredAt: string | null
): VfsCrdtReplicaHeadsParityMismatchReason {
  if (expectedMaxWriteId !== null && actualMaxWriteId === null) {
    return 'missing_head';
  }
  if (expectedMaxWriteId === null && actualMaxWriteId !== null) {
    return 'stale_head';
  }

  const writeIdMismatch = isDistinct(expectedMaxWriteId, actualMaxWriteId);
  const occurredAtMismatch = isDistinct(
    expectedMaxOccurredAt,
    actualMaxOccurredAt
  );

  if (writeIdMismatch && occurredAtMismatch) {
    return 'write_id_and_occurred_at';
  }
  if (writeIdMismatch) {
    return 'write_id';
  }
  if (occurredAtMismatch) {
    return 'occurred_at';
  }

  return 'unknown';
}

function mapMismatchRow(
  row: VfsCrdtReplicaHeadsParityMismatchRow
): VfsCrdtReplicaHeadsParityMismatch {
  const expectedMaxWriteId = toNullableString(row.expected_max_write_id);
  const actualMaxWriteId = toNullableString(row.actual_max_write_id);
  const expectedMaxOccurredAt = parseOccurredAt(row.expected_max_occurred_at);
  const actualMaxOccurredAt = parseOccurredAt(row.actual_max_occurred_at);

  return {
    actorId: row.actor_id,
    replicaId: row.replica_id,
    expectedMaxWriteId,
    actualMaxWriteId,
    expectedMaxOccurredAt,
    actualMaxOccurredAt,
    reason: resolveMismatchReason(
      expectedMaxWriteId,
      actualMaxWriteId,
      expectedMaxOccurredAt,
      actualMaxOccurredAt
    )
  };
}

export async function checkVfsCrdtReplicaHeadsParity(
  client: PgQueryable,
  options: {
    sampleLimit?: number;
  } = {}
): Promise<VfsCrdtReplicaHeadsParityResult> {
  const sampleLimit = parseSampleLimit(
    options.sampleLimit ?? DEFAULT_VFS_CRDT_REPLICA_HEADS_PARITY_SAMPLE_LIMIT
  );

  const countQueryResult = await client.query<VfsCrdtReplicaHeadsParityCountsRow>(
    `
    ${PARITY_COMPARISON_CTE}
    SELECT
      COUNT(*) AS checked_pair_count,
      COUNT(*) FILTER (
        WHERE ${PARITY_MISMATCH_PREDICATE}
      ) AS mismatch_count,
      COUNT(*) FILTER (
        WHERE expected_max_write_id IS NOT NULL
          AND actual_max_write_id IS NULL
      ) AS missing_head_count,
      COUNT(*) FILTER (
        WHERE expected_max_write_id IS NULL
          AND actual_max_write_id IS NOT NULL
      ) AS stale_head_count,
      COUNT(*) FILTER (
        WHERE expected_max_write_id IS NOT NULL
          AND actual_max_write_id IS NOT NULL
          AND expected_max_write_id IS DISTINCT FROM actual_max_write_id
      ) AS write_id_mismatch_count,
      COUNT(*) FILTER (
        WHERE expected_max_occurred_at IS NOT NULL
          AND actual_max_occurred_at IS NOT NULL
          AND expected_max_occurred_at IS DISTINCT FROM actual_max_occurred_at
      ) AS occurred_at_mismatch_count
    FROM joined
    `,
    [CRDT_CLIENT_PUSH_SOURCE_TABLE]
  );

  const countsRow = countQueryResult.rows[0];
  const checkedPairCount = toNonNegativeInteger(countsRow?.checked_pair_count);
  const mismatchCount = toNonNegativeInteger(countsRow?.mismatch_count);
  const missingHeadCount = toNonNegativeInteger(countsRow?.missing_head_count);
  const staleHeadCount = toNonNegativeInteger(countsRow?.stale_head_count);
  const writeIdMismatchCount = toNonNegativeInteger(
    countsRow?.write_id_mismatch_count
  );
  const occurredAtMismatchCount = toNonNegativeInteger(
    countsRow?.occurred_at_mismatch_count
  );

  let mismatches: VfsCrdtReplicaHeadsParityMismatch[] = [];
  if (mismatchCount > 0 && sampleLimit > 0) {
    const mismatchQueryResult =
      await client.query<VfsCrdtReplicaHeadsParityMismatchRow>(
        `
        ${PARITY_COMPARISON_CTE}
        SELECT
          actor_id,
          replica_id,
          expected_max_write_id,
          actual_max_write_id,
          expected_max_occurred_at,
          actual_max_occurred_at
        FROM joined
        WHERE ${PARITY_MISMATCH_PREDICATE}
        ORDER BY actor_id ASC, replica_id ASC
        LIMIT $2::integer
        `,
        [CRDT_CLIENT_PUSH_SOURCE_TABLE, sampleLimit]
      );
    mismatches = mismatchQueryResult.rows.map(mapMismatchRow);
  }

  return {
    checkedPairCount,
    mismatchCount,
    missingHeadCount,
    staleHeadCount,
    writeIdMismatchCount,
    occurredAtMismatchCount,
    sampleLimit,
    sampledMismatchCount: mismatches.length,
    mismatches
  };
}
