interface SqlQuery {
  text: string;
  values: unknown[];
}

export interface VfsCrdtCompactionExecuteOptions {
  maxDeleteRows?: number;
}

interface NormalizedExecuteOptions {
  maxDeleteRows: number | null;
}

function parsePositiveInteger(value: number | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  if (!Number.isFinite(value) || value < 1) {
    return null;
  }

  return Math.trunc(value);
}

function normalizeExecuteOptions(
  options: VfsCrdtCompactionExecuteOptions
): NormalizedExecuteOptions {
  return {
    maxDeleteRows: parsePositiveInteger(options.maxDeleteRows)
  };
}

export function buildVfsCrdtCompactionDeleteQuery(
  cutoffOccurredAt: string,
  options: VfsCrdtCompactionExecuteOptions = {}
): SqlQuery {
  const normalizedOptions = normalizeExecuteOptions(options);
  if (normalizedOptions.maxDeleteRows === null) {
    return {
      text: `
          WITH deleted AS (
            DELETE FROM vfs_crdt_ops
            WHERE occurred_at < $1::timestamptz
            RETURNING 1
          )
          SELECT COUNT(*)::bigint AS count
          FROM deleted
          `,
      values: [cutoffOccurredAt]
    };
  }

  return {
    text: `
          WITH targets AS (
            SELECT id
            FROM vfs_crdt_ops
            WHERE occurred_at < $1::timestamptz
            ORDER BY occurred_at ASC, id ASC
            LIMIT $2::integer
          ),
          deleted AS (
            DELETE FROM vfs_crdt_ops ops
            USING targets
            WHERE ops.id = targets.id
            RETURNING 1
          )
          SELECT COUNT(*)::bigint AS count
          FROM deleted
          `,
    values: [cutoffOccurredAt, normalizedOptions.maxDeleteRows]
  };
}
