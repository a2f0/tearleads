import {
  type DocumentRecord,
  type DocumentScope,
  deleteDocumentPendingUpdate,
  enqueueDocumentPendingUpdate,
  ensureDocumentTables,
  listDocumentPendingUpdates,
  loadDocumentRecord,
  type PendingUpdateFields,
  type PendingUpdateRecord,
  saveDocumentRecord,
} from "../../data/documentPersistence";
import type { SqlRow } from "../../data/sqlSchema";
import {
  type ExecSql,
  ensureSqlTables,
  readSqlRowValue,
  runSerializedSqlMutation,
  runSqlTransaction,
  type SqlTableSchema,
} from "../../data/sqlSchema";

export type { PendingUpdateRecord } from "../../data/documentPersistence";

export interface NoteRecord extends DocumentRecord {
  text: string;
}

export interface PendingUpdateInsert extends PendingUpdateFields {
  noteId: string;
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

const NOTES_APP_KIND = "notes";

const noteProjectionTables: ReadonlyArray<SqlTableSchema> = [
  {
    name: "note_projection",
    createSql: `
      CREATE TABLE IF NOT EXISTS note_projection (
        note_id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
  },
];

function getNoteScope(noteId: string): DocumentScope {
  return {
    appKind: NOTES_APP_KIND,
    localId: noteId,
  };
}

function parseProjectionText(row: SqlRow | undefined): string {
  const text = row ? readSqlRowValue(row, "text") : null;
  return String(text ?? "");
}

export const sqlNotesPersistence: NotesPersistence = {
  async ensureSchema(execSql) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await ensureDocumentTables(lockedExecSql);
      await ensureSqlTables(lockedExecSql, noteProjectionTables);
    });
  },
  async loadNote(execSql, noteId) {
    const [documentRecord, projectionRows] = await Promise.all([
      loadDocumentRecord(execSql, getNoteScope(noteId)),
      execSql(
        `
          SELECT text
          FROM note_projection
          WHERE note_id = :noteId
          LIMIT 1
        `,
        {
          ":noteId": noteId,
        },
      ),
    ]);

    if (!documentRecord) {
      return null;
    }

    return {
      ...documentRecord,
      text: parseProjectionText(projectionRows[0]),
    };
  },
  async saveNote(execSql, note) {
    const updatedAt = new Date().toISOString();

    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await runSqlTransaction(lockedExecSql, async () => {
        await saveDocumentRecord(
          lockedExecSql,
          getNoteScope(note.id),
          note,
          updatedAt,
        );
        await lockedExecSql(
          `
            INSERT INTO note_projection (
              note_id,
              text,
              updated_at
            )
            VALUES (
              :noteId,
              :text,
              :updatedAt
            )
            ON CONFLICT(note_id) DO UPDATE SET
              text = excluded.text,
              updated_at = excluded.updated_at
          `,
          {
            ":noteId": note.id,
            ":text": note.text,
            ":updatedAt": updatedAt,
          },
        );
      });
    });
  },
  async listPendingUpdates(execSql, noteId) {
    return listDocumentPendingUpdates(execSql, getNoteScope(noteId));
  },
  async enqueuePendingUpdate(execSql, pendingUpdate) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await enqueueDocumentPendingUpdate(
        lockedExecSql,
        getNoteScope(pendingUpdate.noteId),
        pendingUpdate,
      );
    });
  },
  async deletePendingUpdate(execSql, id) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await deleteDocumentPendingUpdate(lockedExecSql, id);
    });
  },
};
