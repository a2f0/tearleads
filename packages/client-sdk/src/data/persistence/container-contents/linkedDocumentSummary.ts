import { canWriteEffectiveAccessLevel } from "../../keying/accessLevel";
import type { ExecSql } from "../../sqlite/sqlSchema";
import type { ContainerRecord } from "./containerPersistence";

/** Canonical identity lookup shared by the view and its transactional write guard. */
export async function loadLinkedDocumentSummaryRow(
  execSql: ExecSql,
  input: { containerId: string; documentId: string },
) {
  const rows = await execSql(
    `SELECT d.local_id, d.document_id, ? AS container_id,
      d.document_kind, d.title, d.updated_at,
      stored.access_state_hash, stored.effective_access_level
    FROM document_projection d
    INNER JOIN documents stored ON stored.app_kind = 'documents'
      AND stored.local_id = d.local_id AND stored.document_id = d.document_id
    WHERE d.document_id = ? AND stored.snapshot_end_version != ''
      AND (d.container_id = ? OR EXISTS (
        SELECT 1 FROM document_container_projection linked
        WHERE linked.document_id = d.document_id AND linked.container_id = ?
      ))
      AND NOT EXISTS (
        SELECT 1 FROM container_document_tombstone_holds hold
        WHERE hold.document_id = d.document_id AND hold.container_id = ?
          AND hold.hidden = 1
      )
    LIMIT 1`,
    [
      input.containerId,
      input.documentId,
      input.containerId,
      input.containerId,
      input.containerId,
    ],
  );
  return rows[0] ?? null;
}

/** Call only inside the serialized metadata commit, before any writes. */
export async function assertPrimaryDocumentSelection(
  execSql: ExecSql,
  container: ContainerRecord,
  documentId: string | null | undefined,
) {
  if (documentId === undefined) return;
  if (!canWriteEffectiveAccessLevel(container.effectiveAccessLevel))
    throw new Error("Container is read-only");
  if (
    documentId !== null &&
    !(await loadLinkedDocumentSummaryRow(execSql, {
      containerId: container.id,
      documentId,
    }))
  )
    throw new Error(
      "Primary document is no longer available in this container",
    );
}
