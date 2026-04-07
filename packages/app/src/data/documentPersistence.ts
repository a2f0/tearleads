import type { SqlRow } from "./sqlSchema";
import {
  type ExecSql,
  ensureSqlTables,
  readSqlRowValue,
  runSerializedSqlMutation,
  type SqlTableSchema,
} from "./sqlSchema";

export interface DocumentRecord {
  id: string;
  documentId: string | null;
  documentRecipientEnvelopes: string | null;
  loroSnapshot: string;
  accessEpoch: number;
}

export interface PendingUpdateFields {
  updateData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
}

export interface PendingUpdateRecord extends PendingUpdateFields {
  id: string;
}

export interface DocumentScope {
  appKind: string;
  localId: string;
}

const documentTables: ReadonlyArray<SqlTableSchema> = [
  {
    name: "documents",
    createSql: `
      CREATE TABLE IF NOT EXISTS documents (
        app_kind TEXT NOT NULL,
        local_id TEXT NOT NULL,
        document_id TEXT,
        document_recipient_envelopes TEXT,
        loro_snapshot TEXT NOT NULL,
        access_epoch INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (app_kind, local_id)
      )
    `,
  },
  {
    name: "document_pending_updates",
    createSql: `
      CREATE TABLE IF NOT EXISTS document_pending_updates (
        id TEXT PRIMARY KEY,
        app_kind TEXT NOT NULL,
        local_id TEXT NOT NULL,
        update_data TEXT NOT NULL,
        partial_start_version_vector TEXT NOT NULL,
        partial_end_version_vector TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `,
  },
];

function getScopeBind(scope: DocumentScope) {
  return {
    ":appKind": scope.appKind,
    ":localId": scope.localId,
  };
}

export async function ensureDocumentTables(execSql: ExecSql): Promise<void> {
  await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await ensureSqlTables(lockedExecSql, documentTables);

    const tableInfo = await lockedExecSql("PRAGMA table_info(documents)");
    const hasDocumentRecipientEnvelopesColumn = tableInfo.some(
      (row) => readSqlRowValue(row, "name") === "document_recipient_envelopes",
    );

    if (!hasDocumentRecipientEnvelopesColumn) {
      await lockedExecSql(`
        ALTER TABLE documents
        ADD COLUMN document_recipient_envelopes TEXT
      `);
    }
  });
}

export function parseDocumentRecord(row: SqlRow): DocumentRecord {
  const id = readSqlRowValue(row, "id");
  const documentId = readSqlRowValue(row, "document_id");
  const documentRecipientEnvelopes = readSqlRowValue(
    row,
    "document_recipient_envelopes",
  );
  const loroSnapshot = readSqlRowValue(row, "loro_snapshot");
  const accessEpoch = readSqlRowValue(row, "access_epoch");

  return {
    id: String(id ?? ""),
    documentId: documentId === null ? null : String(documentId),
    documentRecipientEnvelopes:
      documentRecipientEnvelopes === null ||
      documentRecipientEnvelopes === undefined
        ? null
        : String(documentRecipientEnvelopes),
    loroSnapshot: String(loroSnapshot ?? ""),
    accessEpoch: typeof accessEpoch === "number" ? accessEpoch : 1,
  };
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

  return {
    id: String(id),
    updateData: String(updateData ?? ""),
    partialStartVersionVector: String(partialStartVersionVector ?? ""),
    partialEndVersionVector: String(partialEndVersionVector ?? ""),
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
        document_recipient_envelopes,
        loro_snapshot,
        access_epoch
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
          document_recipient_envelopes,
          loro_snapshot,
          access_epoch,
          updated_at
        )
        VALUES (
          :appKind,
          :localId,
          :documentId,
          :documentRecipientEnvelopes,
          :loroSnapshot,
          :accessEpoch,
          :updatedAt
        )
        ON CONFLICT(app_kind, local_id) DO UPDATE SET
          document_id = excluded.document_id,
          document_recipient_envelopes =
            excluded.document_recipient_envelopes,
          loro_snapshot = excluded.loro_snapshot,
          access_epoch = excluded.access_epoch,
          updated_at = excluded.updated_at
      `,
      {
        ...getScopeBind(scope),
        ":documentId": record.documentId,
        ":documentRecipientEnvelopes": record.documentRecipientEnvelopes,
        ":loroSnapshot": record.loroSnapshot,
        ":accessEpoch": record.accessEpoch,
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
          created_at
        )
        VALUES (
          :id,
          :appKind,
          :localId,
          :updateData,
          :partialStartVersionVector,
          :partialEndVersionVector,
          :createdAt
        )
      `,
      {
        ...getScopeBind(scope),
        ":id": crypto.randomUUID(),
        ":updateData": pendingUpdate.updateData,
        ":partialStartVersionVector": pendingUpdate.partialStartVersionVector,
        ":partialEndVersionVector": pendingUpdate.partialEndVersionVector,
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
