import type { createTestExecSql } from "@tearleads/test-utils";

type ExecSql = Awaited<ReturnType<typeof createTestExecSql>>["execSql"];

/** One queued outgoing document update, as an install's outbox holds it. */
export interface QueuedDocumentUpdate {
  readonly origin: string;
  readonly partialEndVersionVector: string;
  readonly partialStartVersionVector: string;
  readonly sourceVersionVector: string | null;
  readonly updateData: string;
}

function text(value: unknown, column: string): string {
  if (typeof value !== "string") throw new Error(`Expected ${column} text`);
  return value;
}

/** The install's queued updates of `documentId`, oldest first. */
export async function readQueuedDocumentUpdates(
  execSql: ExecSql,
  documentId: string,
): Promise<QueuedDocumentUpdate[]> {
  const rows = await execSql(
    `SELECT h.update_data AS updateData, h.origin AS origin,
            h.partial_start_version_vector AS startVersion,
            h.partial_end_version_vector AS endVersion,
            h.source_version_vector AS sourceVersion
       FROM document_history_updates h
       JOIN documents d
         ON d.app_kind = h.app_kind AND d.local_id = h.local_id
      WHERE h.app_kind = 'documents' AND d.document_id = ?
        AND h.update_id IS NOT NULL
      ORDER BY h.created_at, h.rowid`,
    [documentId],
  );
  return rows.map(
    ({ endVersion, origin, sourceVersion, startVersion, updateData }) => ({
      origin: text(origin, "origin"),
      partialEndVersionVector: text(endVersion, "end version"),
      partialStartVersionVector: text(startVersion, "start version"),
      sourceVersionVector:
        typeof sourceVersion === "string" ? sourceVersion : null,
      updateData: text(updateData, "update data"),
    }),
  );
}

/**
 * Queues `update` for `documentId` in this install's own outbox under a fresh
 * update id, as a modified client relaying another writer's operations
 * could. A reused update id would collide with the writer's own send.
 */
export async function queueRelayedDocumentUpdate(
  execSql: ExecSql,
  documentId: string,
  update: QueuedDocumentUpdate,
): Promise<void> {
  const [{ localId } = {}] = await execSql(
    `SELECT local_id AS localId FROM documents
      WHERE app_kind = 'documents' AND document_id = ?`,
    [documentId],
  );
  await execSql(
    `INSERT INTO document_history_updates
       (id, app_kind, local_id, update_data, origin, created_at, update_id,
        partial_start_version_vector, partial_end_version_vector,
        source_version_vector)
     VALUES (?, 'documents', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      text(localId, "local id"),
      update.updateData,
      update.origin,
      new Date().toISOString(),
      crypto.randomUUID(),
      update.partialStartVersionVector,
      update.partialEndVersionVector,
      update.sourceVersionVector,
    ],
  );
}
