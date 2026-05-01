import { documentTables } from "./schema";
import type { SqlRow } from "./sqlSchema";
import {
  type ExecSql,
  ensureSqlTables,
  readSqlRowValue,
  runSerializedSqlMutation,
} from "./sqlSchema";

export interface DocumentRecord {
  id: string;
  documentId: string | null;
  loroSnapshot: string;
  accessEpoch: number;
  accessStateHash?: string | null;
  lastCommitLsn?: string | null;
  contentKeyBundle?: string | null;
  documentKekTargets?: string | null;
  documentManifestBundle?: string | null;
}

export interface PendingUpdateFields {
  updateData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
  sourceVersionVector?: string | null;
}

export interface PendingUpdateRecord extends PendingUpdateFields {
  id: string;
}

export interface DocumentScope {
  appKind: string;
  localId: string;
}

function getScopeBind(scope: DocumentScope) {
  return {
    ":appKind": scope.appKind,
    ":localId": scope.localId,
  };
}

export async function ensureDocumentTables(execSql: ExecSql): Promise<void> {
  await ensureSqlTables(execSql, documentTables);
}

export function parseDocumentRecord(row: SqlRow): DocumentRecord {
  const id = readSqlRowValue(row, "id");
  const documentId = readSqlRowValue(row, "document_id");
  const loroSnapshot = readSqlRowValue(row, "loro_snapshot");
  const accessEpoch = readSqlRowValue(row, "access_epoch");
  const accessStateHash = readSqlRowValue(row, "access_state_hash");
  const lastCommitLsn = readSqlRowValue(row, "last_commit_lsn");
  const contentKeyBundle = readSqlRowValue(row, "content_key_bundle");
  const documentKekTargets = readSqlRowValue(row, "document_kek_targets");
  const documentManifestBundle = readSqlRowValue(
    row,
    "document_manifest_bundle",
  );

  const record: DocumentRecord = {
    id: String(id ?? ""),
    documentId: documentId === null ? null : String(documentId),
    loroSnapshot: String(loroSnapshot ?? ""),
    accessEpoch: typeof accessEpoch === "number" ? accessEpoch : 1,
    lastCommitLsn:
      lastCommitLsn === null || lastCommitLsn === undefined
        ? null
        : String(lastCommitLsn),
    contentKeyBundle:
      contentKeyBundle === null || contentKeyBundle === undefined
        ? null
        : String(contentKeyBundle),
    documentKekTargets:
      documentKekTargets === null || documentKekTargets === undefined
        ? null
        : String(documentKekTargets),
    documentManifestBundle:
      documentManifestBundle === null || documentManifestBundle === undefined
        ? null
        : String(documentManifestBundle),
  };

  if (accessStateHash !== null && accessStateHash !== undefined) {
    record.accessStateHash = String(accessStateHash);
  }

  return record;
}

function parsePendingUpdateRecord(row: SqlRow): PendingUpdateRecord {
  const id = readSqlRowValue(row, "id");
  const updateData = readSqlRowValue(row, "update_data");
  const partialStartVersionVector = readSqlRowValue(
    row,
    "partial_start_version_vector",
  );
  const partialEndVersionVector = readSqlRowValue(
    row,
    "partial_end_version_vector",
  );
  const sourceVersionVector = readSqlRowValue(row, "source_version_vector");

  return {
    id: String(id),
    updateData: String(updateData ?? ""),
    partialStartVersionVector: String(partialStartVersionVector ?? ""),
    partialEndVersionVector: String(partialEndVersionVector ?? ""),
    sourceVersionVector:
      sourceVersionVector === null || sourceVersionVector === undefined
        ? null
        : String(sourceVersionVector),
  };
}

export async function loadDocumentRecord(
  execSql: ExecSql,
  scope: DocumentScope,
): Promise<DocumentRecord | null> {
  const rows = await execSql(
    `
 SELECT
 local_id AS id,
 document_id,
 loro_snapshot,
 access_epoch,
 access_state_hash,
 last_commit_lsn,
 document_manifest_bundle,
 content_key_bundle,
 document_kek_targets
 FROM documents
 WHERE app_kind = :appKind AND local_id = :localId
 LIMIT 1
 `,
    getScopeBind(scope),
  );

  return rows[0] ? parseDocumentRecord(rows[0]) : null;
}

export async function findLocalIdByDocumentId(
  execSql: ExecSql,
  appKind: string,
  documentId: string,
): Promise<string | null> {
  const rows = await execSql(
    `
 SELECT local_id
 FROM documents
 WHERE app_kind = :appKind AND document_id = :documentId
 LIMIT 1
 `,
    {
      ":appKind": appKind,
      ":documentId": documentId,
    },
  );

  const localId = readSqlRowValue(rows[0] ?? {}, "local_id");
  return typeof localId === "string" ? localId : null;
}

export async function saveDocumentRecord(
  execSql: ExecSql,
  scope: DocumentScope,
  record: DocumentRecord,
  updatedAt: string,
): Promise<void> {
  await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await lockedExecSql(
      `
 INSERT INTO documents (
 app_kind,
 local_id,
 document_id,
 loro_snapshot,
 access_epoch,
 access_state_hash,
 last_commit_lsn,
 document_manifest_bundle,
 content_key_bundle,
 document_kek_targets,
 updated_at
 )
 VALUES (
 :appKind,
 :localId,
 :documentId,
 :loroSnapshot,
 :accessEpoch,
 :accessStateHash,
 :lastCommitLsn,
 :documentManifestBundle,
 :contentKeyBundle,
 :documentKekTargets,
 :updatedAt
 )
 ON CONFLICT(app_kind, local_id) DO UPDATE SET
 document_id = excluded.document_id,
 loro_snapshot = excluded.loro_snapshot,
 access_epoch = excluded.access_epoch,
 access_state_hash = excluded.access_state_hash,
 last_commit_lsn = excluded.last_commit_lsn,
 document_manifest_bundle =
 excluded.document_manifest_bundle,
 content_key_bundle = excluded.content_key_bundle,
 document_kek_targets = excluded.document_kek_targets,
 updated_at = excluded.updated_at
 `,
      {
        ...getScopeBind(scope),
        ":documentId": record.documentId,
        ":loroSnapshot": record.loroSnapshot,
        ":accessEpoch": record.accessEpoch,
        ":accessStateHash": record.accessStateHash ?? null,
        ":lastCommitLsn": record.lastCommitLsn ?? null,
        ":contentKeyBundle": record.contentKeyBundle ?? null,
        ":documentKekTargets": record.documentKekTargets ?? null,
        ":documentManifestBundle": record.documentManifestBundle ?? null,
        ":updatedAt": updatedAt,
      },
    );
  });
}

export async function deleteDocumentRecord(
  execSql: ExecSql,
  scope: DocumentScope,
): Promise<void> {
  await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await lockedExecSql(
      `
 DELETE FROM documents
 WHERE app_kind = :appKind AND local_id = :localId
 `,
      getScopeBind(scope),
    );
  });
}

export async function listDocumentPendingUpdates(
  execSql: ExecSql,
  scope: DocumentScope,
): Promise<PendingUpdateRecord[]> {
  const rows = await execSql(
    `
 SELECT id, update_data
 , partial_start_version_vector
 , partial_end_version_vector
 , source_version_vector
 FROM document_pending_updates
 WHERE app_kind = :appKind AND local_id = :localId
 ORDER BY created_at ASC
 `,
    getScopeBind(scope),
  );

  return rows.map((row) => parsePendingUpdateRecord(row));
}

export async function enqueueDocumentPendingUpdate(
  execSql: ExecSql,
  scope: DocumentScope,
  pendingUpdate: PendingUpdateFields,
): Promise<void> {
  await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await lockedExecSql(
      `
 INSERT INTO document_pending_updates (
 id,
 app_kind,
 local_id,
 update_data,
 partial_start_version_vector,
 partial_end_version_vector,
 source_version_vector,
 created_at
 )
 VALUES (
 :id,
 :appKind,
 :localId,
 :updateData,
 :partialStartVersionVector,
 :partialEndVersionVector,
 :sourceVersionVector,
 :createdAt
 )
 `,
      {
        ...getScopeBind(scope),
        ":id": crypto.randomUUID(),
        ":updateData": pendingUpdate.updateData,
        ":partialStartVersionVector": pendingUpdate.partialStartVersionVector,
        ":partialEndVersionVector": pendingUpdate.partialEndVersionVector,
        ":sourceVersionVector": pendingUpdate.sourceVersionVector ?? null,
        ":createdAt": new Date().toISOString(),
      },
    );
  });
}

export async function deleteDocumentPendingUpdate(
  execSql: ExecSql,
  id: string,
): Promise<void> {
  await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await lockedExecSql(
      `
 DELETE FROM document_pending_updates
 WHERE id = :id
 `,
      {
        ":id": id,
      },
    );
  });
}

export async function deleteDocumentPendingUpdates(
  execSql: ExecSql,
  scope: DocumentScope,
): Promise<void> {
  await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await lockedExecSql(
      `
 DELETE FROM document_pending_updates
 WHERE app_kind = :appKind AND local_id = :localId
 `,
      getScopeBind(scope),
    );
  });
}
