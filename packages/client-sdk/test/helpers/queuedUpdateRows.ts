import type { ExecSql } from "../../src/data/sqlite/sqlSchema";

/**
 * The outbound write queue as a SQL relation: the update-log rows that carry
 * an `update_id`, with that queued update id exposed as `id`.
 */
export const QUEUED_UPDATES_SQL = `(
  SELECT update_id AS id, app_kind, local_id, update_data, origin,
    created_at, rekey_count
  FROM document_history_updates
  WHERE update_id IS NOT NULL
)`;

interface QueuedUpdateRowInput {
  readonly appKind: string;
  readonly createdAt?: string;
  /** The queued update id. */
  readonly id: string;
  readonly localId: string;
  readonly partialEndVersionVector?: string;
  readonly partialStartVersionVector?: string;
  readonly updateData?: string;
}

/** Seed queued updates that have no history-tail role ("outbox" rows). */
export async function insertQueuedUpdateRows(
  execSql: ExecSql,
  rows: readonly QueuedUpdateRowInput[],
): Promise<void> {
  for (const row of rows) {
    await execSql(
      `INSERT INTO document_history_updates (
        id, app_kind, local_id, update_data, origin, created_at,
        update_id, partial_start_version_vector, partial_end_version_vector
      ) VALUES (?, ?, ?, ?, 'outbox', ?, ?, ?, ?)`,
      [
        `${row.id}-row`,
        row.appKind,
        row.localId,
        row.updateData ?? "data",
        row.createdAt ?? "now",
        row.id,
        row.partialStartVersionVector ?? "",
        row.partialEndVersionVector ?? "",
      ],
    );
  }
}
