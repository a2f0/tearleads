import {
  type DocumentRecord,
  type DocumentScope,
  deleteDocumentPendingUpdate,
  deleteDocumentPendingUpdates,
  enqueueDocumentPendingUpdate,
  ensureDocumentTables,
  findLocalIdByDocumentId,
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
  containerId: string | null;
  text: string;
}

export interface NoteSummary {
  id: string;
  containerId: string | null;
  documentId: string | null;
  title: string;
  updatedAt: string;
}

export interface PendingUpdateInsert extends PendingUpdateFields {
  noteId: string;
}

export interface DiscoveredNoteInput {
  accessEpoch: number;
  containerId: string;
  createdAt: string;
  documentId: string;
}

export interface NotesPersistence {
  ensureSchema: (execSql: ExecSql) => Promise<void>;
  listNotes: (execSql: ExecSql) => Promise<NoteSummary[]>;
  loadNote: (execSql: ExecSql, noteId: string) => Promise<NoteRecord | null>;
  saveNote: (execSql: ExecSql, note: NoteRecord) => Promise<void>;
  upsertDiscoveredNote: (
    execSql: ExecSql,
    input: DiscoveredNoteInput,
  ) => Promise<NoteSummary>;
  listPendingUpdates: (
    execSql: ExecSql,
    noteId: string,
  ) => Promise<PendingUpdateRecord[]>;
  enqueuePendingUpdate: (
    execSql: ExecSql,
    pendingUpdate: PendingUpdateInsert,
  ) => Promise<void>;
  deletePendingUpdate: (execSql: ExecSql, id: string) => Promise<void>;
  deletePendingUpdates: (execSql: ExecSql, noteId: string) => Promise<void>;
}

const NOTES_APP_KIND = "notes";

const noteProjectionTables: ReadonlyArray<SqlTableSchema> = [
  {
    name: "note_projection",
    createSql: `
      CREATE TABLE IF NOT EXISTS note_projection (
        note_id TEXT PRIMARY KEY,
        document_id TEXT,
        container_id TEXT,
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

function parseProjectionContainerId(row: SqlRow | undefined): string | null {
  const containerId = row ? readSqlRowValue(row, "container_id") : null;
  return containerId === null || containerId === undefined
    ? null
    : String(containerId);
}

function parseProjectionDocumentId(row: SqlRow | undefined): string | null {
  const documentId = row ? readSqlRowValue(row, "document_id") : null;
  return documentId === null || documentId === undefined
    ? null
    : String(documentId);
}

function parseProjectionUpdatedAt(row: SqlRow | undefined): string {
  const updatedAt = row ? readSqlRowValue(row, "updated_at") : null;
  return String(updatedAt ?? "");
}

export function deriveNoteTitle(text: string): string {
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return "Untitled note";
}

export const sqlNotesPersistence: NotesPersistence = {
  async ensureSchema(execSql) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await ensureDocumentTables(lockedExecSql);
      await ensureSqlTables(lockedExecSql, noteProjectionTables);
    });
  },
  async listNotes(execSql) {
    const rows = await execSql(
      `
        SELECT
          note_id,
          document_id,
          container_id,
          text,
          updated_at
        FROM note_projection
        ORDER BY updated_at DESC
      `,
    );

    return rows.map((row) => ({
      id: String(readSqlRowValue(row, "note_id") ?? ""),
      containerId: parseProjectionContainerId(row),
      documentId: parseProjectionDocumentId(row),
      title: deriveNoteTitle(parseProjectionText(row)),
      updatedAt: parseProjectionUpdatedAt(row),
    }));
  },
  async loadNote(execSql, noteId) {
    const [documentRecord, projectionRows] = await Promise.all([
      loadDocumentRecord(execSql, getNoteScope(noteId)),
      execSql(
        `
          SELECT
            text,
            container_id
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
      containerId: parseProjectionContainerId(projectionRows[0]),
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
              document_id,
              container_id,
              text,
              updated_at
            )
            VALUES (
              :noteId,
              :documentId,
              :containerId,
              :text,
              :updatedAt
            )
            ON CONFLICT(note_id) DO UPDATE SET
              document_id = excluded.document_id,
              container_id = excluded.container_id,
              text = excluded.text,
              updated_at = excluded.updated_at
          `,
          {
            ":noteId": note.id,
            ":documentId": note.documentId,
            ":containerId": note.containerId,
            ":text": note.text,
            ":updatedAt": updatedAt,
          },
        );
      });
    });
  },
  async upsertDiscoveredNote(execSql, input) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await ensureDocumentTables(lockedExecSql);
      await ensureSqlTables(lockedExecSql, noteProjectionTables);
    });

    const existingLocalId = await findLocalIdByDocumentId(
      execSql,
      NOTES_APP_KIND,
      input.documentId,
    );
    const noteId = existingLocalId ?? input.documentId;
    const existingNote = await sqlNotesPersistence.loadNote(execSql, noteId);

    const nextNote: NoteRecord = {
      id: noteId,
      containerId: input.containerId,
      documentId: input.documentId,
      text: existingNote?.text ?? "",
      loroSnapshot: existingNote?.loroSnapshot ?? "",
      accessEpoch: Math.max(existingNote?.accessEpoch ?? 1, input.accessEpoch),
    };

    await sqlNotesPersistence.saveNote(execSql, nextNote);

    return {
      id: noteId,
      containerId: nextNote.containerId,
      documentId: nextNote.documentId,
      title: deriveNoteTitle(nextNote.text),
      updatedAt: input.createdAt,
    };
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
  async deletePendingUpdates(execSql, noteId) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await deleteDocumentPendingUpdates(lockedExecSql, getNoteScope(noteId));
    });
  },
};
