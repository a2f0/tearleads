import {
  createDocument,
  exportFullHistorySnapshot,
  getUpdateVersionVectors,
  importSnapshot,
  importUpdates,
} from "@tearleads/loro";
import type { createTestExecSql } from "@tearleads/test-utils";

type ExecSql = Awaited<ReturnType<typeof createTestExecSql>>["execSql"];

const decode = (value: unknown) => {
  if (typeof value !== "string") throw new Error("Expected base64 text");
  return new Uint8Array(Buffer.from(value, "base64"));
};

async function queuedRows(execSql: ExecSql) {
  const rows = await execSql(
    `SELECT id, local_id AS localId, created_at AS createdAt, rowid AS seq
       FROM document_history_updates
      WHERE app_kind = 'documents' AND update_id IS NOT NULL
      ORDER BY created_at, rowid`,
  );
  return rows.flatMap(({ createdAt, id, localId, seq }) =>
    typeof createdAt === "string" &&
    typeof id === "string" &&
    typeof localId === "string" &&
    typeof seq === "number"
      ? [{ createdAt, id, localId, seq }]
      : [],
  );
}

/**
 * Rewrites the first queued document row into a rotation checkpoint: a
 * full-history snapshot of the local history through that row, declaring the
 * frontier it ends at. Rows queued after it stay ordinary updates, so the
 * checkpoint is the only update that carries the row's own edit. Returns how
 * many queued rows follow it.
 */
export async function forgeFirstQueuedRowAsCheckpoint(
  execSql: ExecSql,
): Promise<number> {
  const queued = await queuedRows(execSql);
  const [first] = queued;
  if (!first) throw new Error("Expected a queued document update");
  const checkpoints = await execSql(
    `SELECT snapshot FROM document_history_checkpoints
      WHERE app_kind = 'documents' AND local_id = ?`,
    [first.localId],
  );
  const tail = await execSql(
    `SELECT update_data AS data FROM document_history_updates
      WHERE app_kind = 'documents' AND local_id = ?
        AND (created_at < ? OR (created_at = ? AND rowid <= ?))
      ORDER BY created_at, rowid`,
    [first.localId, first.createdAt, first.createdAt, first.seq],
  );
  const history = await createDocument("forged-checkpoint");
  for (const { snapshot } of checkpoints) {
    importSnapshot(history, decode(snapshot));
  }
  importUpdates(
    history,
    tail.map(({ data }) => decode(data)),
  );
  const snapshot = exportFullHistorySnapshot(history);
  history.free();
  const vectors = getUpdateVersionVectors(snapshot);
  await execSql(
    `UPDATE document_history_updates
        SET update_data = ?, partial_start_version_vector = ?,
            partial_end_version_vector = ?, source_version_vector = ?
      WHERE id = ?`,
    [
      Buffer.from(snapshot).toString("base64"),
      vectors.partialStartVersionVector,
      vectors.partialEndVersionVector,
      vectors.partialEndVersionVector,
      first.id,
    ],
  );
  return queued.length - 1;
}
