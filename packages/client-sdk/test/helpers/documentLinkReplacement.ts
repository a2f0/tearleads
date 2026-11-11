import { DOCUMENTS_APP_KIND } from "../../src/data/documents/documentConstants";
import { sqlDocumentContainerProjectionPersistence as links } from "../../src/data/persistence/container-contents/documentContainerProjectionPersistence";
import type { ExecSql } from "../../src/data/sqlite/sqlSchema";

const replacementBefore = "2026-01-01T00:00:00.000Z";
export const replacementId = (index: number) =>
  `document-${String(index).padStart(4, "0")}`;

/** Writable documents followed by a pending move and a higher-epoch alias. */
export async function seedDocumentLinkReplacement(
  execSql: ExecSql,
  writableCount: number,
) {
  await links.replaceDocumentLinksBatch(execSql, []);
  await execSql(
    `WITH RECURSIVE ids(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM ids WHERE i+1 < ?)
     INSERT INTO documents (app_kind, local_id, document_id, access_epoch, updated_at)
     SELECT ?, printf('local-%04d', i), printf('document-%04d', i), 2, ? FROM ids`,
    [writableCount + 2, DOCUMENTS_APP_KIND, replacementBefore],
  );
  for (const container of ["old", "new"]) {
    await execSql(
      `INSERT INTO document_container_projection (document_id, container_id, updated_at)
       SELECT document_id, ?, ? FROM documents`,
      [container, replacementBefore],
    );
    await execSql(
      `INSERT INTO container_document_tombstone_holds (document_id, container_id, tombstoned_at, updated_at)
       SELECT document_id, ?, ?, ? FROM documents`,
      [container, replacementBefore, replacementBefore],
    );
  }
  await execSql(
    `INSERT INTO document_container_projection (document_id, container_id, updated_at)
     VALUES ('outside', 'old', ?)`,
    [replacementBefore],
  );
  await execSql(
    `INSERT INTO local_intents (id, lane, intent_type, subject_id, local_id,
       target_container_id, sync_status, created_at, updated_at)
     VALUES ('owned-move', 'document.placement', 'document.move', ?,
       ?, 'destination', 'pending', ?, ?)`,
    [
      replacementId(writableCount),
      `local-${String(writableCount).padStart(4, "0")}`,
      replacementBefore,
      replacementBefore,
    ],
  );
  await execSql(
    `INSERT INTO documents (app_kind, local_id, document_id, access_epoch, updated_at)
     VALUES (?, 'newer-alias', ?, 9, ?)`,
    [DOCUMENTS_APP_KIND, replacementId(writableCount + 1), replacementBefore],
  );
  const inputs = Array.from({ length: writableCount + 2 }, (_, index) => ({
    documentId: replacementId(index),
    containerIds: ["new", "new"],
    accessEpoch: 2,
  }));
  // Last input wins across the deletion batch boundary, including no links.
  inputs.push(
    {
      documentId: replacementId(0),
      containerIds: ["last", "last"],
      accessEpoch: 2,
    },
    {
      documentId: replacementId(writableCount - 1),
      containerIds: [],
      accessEpoch: 2,
    },
  );
  return inputs;
}

export function readReplacementLinks(execSql: ExecSql) {
  return execSql(
    "SELECT document_id, container_id FROM document_container_projection ORDER BY document_id, container_id",
  );
}

export function readReplacementHolds(execSql: ExecSql) {
  return execSql(
    "SELECT * FROM container_document_tombstone_holds ORDER BY document_id, container_id",
  );
}
