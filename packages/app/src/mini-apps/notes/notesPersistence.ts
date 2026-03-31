import type { SqlRow } from "../../data/AppDataProvider";
import {
  type ExecSql,
  ensureSqlTables,
  readSqlRowValue,
  type SqlTableSchema,
} from "../../data/sqlSchema";

export interface NoteRecord {
  id: string;
  documentId: string | null;
  text: string;
  loroSnapshot: string;
  accessEpoch: number;
}

export interface PendingUpdateRecord {
  id: string;
  updateData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
}

export interface PendingUpdateInsert {
  noteId: string;
  updateData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
}

export interface NotesPersistence {
  ensureSchema: (execSql: ExecSql) => Promise<void>;
  loadNote: (execSql: ExecSql, noteId: string) => Promise<NoteRecord | null>;
  saveNote: (execSql: ExecSql, note: NoteRecord) => Promise<void>;
  listPendingUpdates: (
    execSql: ExecSql,
    noteId: string,
  ) => Promise<PendingUpdateRecord[]>;
  enqueuePendingUpdate: (
    execSql: ExecSql,
    pendingUpdate: PendingUpdateInsert,
  ) => Promise<void>;
  deletePendingUpdate: (execSql: ExecSql, id: string) => Promise<void>;
}

const notesTables: ReadonlyArray<SqlTableSchema> = [
  {
    name: "notes",
    createSql: `
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        document_id TEXT,
        text TEXT NOT NULL,
        loro_snapshot TEXT NOT NULL,
        access_epoch INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      )
    `,
    requiredColumns: [
      {
        name: "access_epoch",
        addSql:
          "ALTER TABLE notes ADD COLUMN access_epoch INTEGER NOT NULL DEFAULT 1",
      },
    ],
  },
  {
    name: "note_pending_updates",
    createSql: `
      CREATE TABLE IF NOT EXISTS note_pending_updates (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL,
        update_data TEXT NOT NULL,
        partial_start_version_vector TEXT NOT NULL,
        partial_end_version_vector TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `,
    requiredColumns: [
      {
        name: "partial_start_version_vector",
        addSql:
          "ALTER TABLE note_pending_updates ADD COLUMN partial_start_version_vector TEXT NOT NULL DEFAULT ''",
      },
      {
        name: "partial_end_version_vector",
        addSql:
          "ALTER TABLE note_pending_updates ADD COLUMN partial_end_version_vector TEXT NOT NULL DEFAULT ''",
      },
    ],
  },
];

function parseNoteRecord(value: SqlRow): NoteRecord {
  const id = readSqlRowValue(value, "id");
  const documentId = readSqlRowValue(value, "document_id");
  const text = readSqlRowValue(value, "text");
  const loroSnapshot = readSqlRowValue(value, "loro_snapshot");
  const accessEpoch = readSqlRowValue(value, "access_epoch");

  return {
    id: String(id ?? ""),
    documentId: documentId === null ? null : String(documentId),
    text: String(text ?? ""),
    loroSnapshot: String(loroSnapshot ?? ""),
    accessEpoch: typeof accessEpoch === "number" ? accessEpoch : 1,
  };
}

function parsePendingUpdateRecord(value: SqlRow): PendingUpdateRecord {
  const id = readSqlRowValue(value, "id");
  const updateData = readSqlRowValue(value, "update_data");
  const partialStartVersionVector = readSqlRowValue(
    value,
    "partial_start_version_vector",
  );
  const partialEndVersionVector = readSqlRowValue(
    value,
    "partial_end_version_vector",
  );

  return {
    id: String(id),
    updateData: String(updateData ?? ""),
    partialStartVersionVector: String(partialStartVersionVector ?? ""),
    partialEndVersionVector: String(partialEndVersionVector ?? ""),
  };
}

export const sqlNotesPersistence: NotesPersistence = {
  async ensureSchema(execSql) {
    await ensureSqlTables(execSql, notesTables);
  },
  async loadNote(execSql, noteId) {
    const rows = await execSql(
      `
        SELECT id, document_id, text, loro_snapshot, access_epoch
        FROM notes
        WHERE id = :id
        LIMIT 1
      `,
      {
        ":id": noteId,
      },
    );

    return rows[0] ? parseNoteRecord(rows[0]) : null;
  },
  async saveNote(execSql, note) {
    await execSql(
      `
        INSERT INTO notes (
          id,
          document_id,
          text,
          loro_snapshot,
          access_epoch,
          updated_at
        )
        VALUES (
          :id,
          :documentId,
          :text,
          :loroSnapshot,
          :accessEpoch,
          :updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          document_id = excluded.document_id,
          text = excluded.text,
          loro_snapshot = excluded.loro_snapshot,
          access_epoch = excluded.access_epoch,
          updated_at = excluded.updated_at
      `,
      {
        ":id": note.id,
        ":documentId": note.documentId,
        ":text": note.text,
        ":loroSnapshot": note.loroSnapshot,
        ":accessEpoch": note.accessEpoch,
        ":updatedAt": new Date().toISOString(),
      },
    );
  },
  async listPendingUpdates(execSql, noteId) {
    const rows = await execSql(
      `
        SELECT id, update_data
          , partial_start_version_vector
          , partial_end_version_vector
        FROM note_pending_updates
        WHERE note_id = :noteId
        ORDER BY created_at ASC
      `,
      {
        ":noteId": noteId,
      },
    );

    return rows.map((row) => parsePendingUpdateRecord(row));
  },
  async enqueuePendingUpdate(execSql, pendingUpdate) {
    await execSql(
      `
        INSERT INTO note_pending_updates (
          id,
          note_id,
          update_data,
          partial_start_version_vector,
          partial_end_version_vector,
          created_at
        )
        VALUES (
          :id,
          :noteId,
          :updateData,
          :partialStartVersionVector,
          :partialEndVersionVector,
          :createdAt
        )
      `,
      {
        ":id": crypto.randomUUID(),
        ":noteId": pendingUpdate.noteId,
        ":updateData": pendingUpdate.updateData,
        ":partialStartVersionVector": pendingUpdate.partialStartVersionVector,
        ":partialEndVersionVector": pendingUpdate.partialEndVersionVector,
        ":createdAt": new Date().toISOString(),
      },
    );
  },
  async deletePendingUpdate(execSql, id) {
    await execSql(
      `
        DELETE FROM note_pending_updates
        WHERE id = :id
      `,
      {
        ":id": id,
      },
    );
  },
};
