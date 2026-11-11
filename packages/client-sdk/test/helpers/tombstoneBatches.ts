import { DOCUMENTS_APP_KIND } from "../../src/data/documents/documentConstants";
import { sqlDocumentsPersistence } from "../../src/data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../src/data/sqlite/sqlSchema";

const tombstoneBefore = "2026-01-01T00:00:00.000Z";
export const tombstoneAfter = "2026-01-02T00:00:00.000Z";
const tombstoneNewer = "2026-01-03T00:00:00.000Z";

/** Real records, two signed links and one listing-only link per document. */
export async function seedTombstoneBatch(execSql: ExecSql, count: number) {
  await sqlDocumentsPersistence.ensureSchema(execSql);
  await execSql(
    `WITH RECURSIVE ids(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM ids WHERE i+1 < ?)
     INSERT INTO documents (app_kind, local_id, document_id, access_epoch, updated_at)
     SELECT ?, printf('local-%04d', i), printf('document-%04d', i), 2, ? FROM ids`,
    [count, DOCUMENTS_APP_KIND, tombstoneBefore],
  );
  await execSql(
    `INSERT INTO document_projection (local_id, document_id, container_id, title, updated_at)
     SELECT local_id, document_id, 'removed', 'Title ' || local_id,
       CASE WHEN CAST(substr(local_id, 7) AS INTEGER) % 2 = 0 THEN ? ELSE ? END
     FROM documents`,
    [tombstoneBefore, tombstoneNewer],
  );
  for (const container of ["removed", "survivor", "listing-only"]) {
    await execSql(
      `INSERT INTO document_container_projection (document_id, container_id, updated_at)
       SELECT document_id, ?, ? FROM documents`,
      [container, tombstoneBefore],
    );
  }
  return Array.from({ length: count }, (_, i) => ({
    documentId: `document-${String(i).padStart(4, "0")}`,
    containerId: "removed",
    accessEpoch: 2,
    linkedContainerIds: ["survivor"],
    updatedAt: tombstoneAfter,
  }));
}

export async function seedTombstoneGuards(execSql: ExecSql) {
  await execSql(
    `INSERT INTO local_intents (id, lane, intent_type, subject_id, local_id,
       target_container_id, sync_status, created_at, updated_at)
     VALUES ('pending', 'document.placement', 'document.move', 'document-0999',
       'local-0999', 'destination', 'pending', ?, ?)`,
    [tombstoneBefore, tombstoneBefore],
  );
  // One server document legitimately has two local rows: the maximum epoch
  // across them must protect both, not whichever row a read happens to return.
  for (const [localId, documentId, epoch] of [
    ["stale-alias", "document-1000", 9],
    ["\uE000", "document-0002", 2],
    ["\u{10000}", "document-0998", 2],
  ] as const) {
    await execSql(
      `INSERT INTO documents (app_kind, local_id, document_id, access_epoch, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [DOCUMENTS_APP_KIND, localId, documentId, epoch, tombstoneBefore],
    );
    await execSql(
      `INSERT INTO document_projection (local_id, document_id, container_id, title, updated_at)
       VALUES (?, ?, 'removed', 'Alias', ?)`,
      [localId, documentId, tombstoneBefore],
    );
  }
}
