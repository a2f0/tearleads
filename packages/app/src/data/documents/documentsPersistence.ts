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
} from "../documentPersistence";
import type { SqlRow } from "../sqlSchema";
import {
  type ExecSql,
  ensureSqlTables,
  readSqlRowValue,
  runSerializedSqlMutation,
  runSqlTransaction,
  type SqlTableSchema,
} from "../sqlSchema";
import {
  deriveStoredDocumentKind,
  deriveStoredDocumentTitle,
  type StoredDocumentKind,
} from "./documentKinds";

export type { PendingUpdateRecord } from "../documentPersistence";

export type StoredDocumentRecord = NoteRecord;
export type DocumentSummary = NoteSummary;
export type DocumentsPersistence = NotesPersistence;

export interface NoteRecord extends DocumentRecord {
  containerId: string | null;
  text: string;
}

export interface NoteSummary {
  id: string;
  containerId: string | null;
  documentKind?: StoredDocumentKind;
  documentId: string | null;
  title: string;
  updatedAt: string;
}

export interface PendingUpdateInsert extends PendingUpdateFields {
  noteId: string;
}

export interface PendingAttachmentRecord {
  byteLength: number;
  mimeType: string | null;
  name: string;
  noteId: string;
  slotId: string;
  storageKey: string;
}

export interface PendingAttachmentRewrapRecord {
  blobId: string;
  noteId: string;
  slotId: string;
}

export interface PendingAttachmentReplacementRecord {
  blobId: string | null;
  noteId: string;
  slotId: string;
}

export interface LocalAttachmentRecord {
  blobId: string | null;
  byteLength: number;
  mimeType: string | null;
  noteId: string;
  slotId: string;
  storageKey: string;
}

export interface DiscoveredNoteInput {
  accessEpoch: number;
  containerId: string;
  createdAt: string;
  documentId: string;
  linkedContainerIds: ReadonlyArray<string>;
}

export interface RelinkPersistedNoteInput {
  accessEpoch: number;
  containerId: string;
  documentId: string;
  noteId: string;
}

export interface NotesPersistence {
  ensureSchema: (execSql: ExecSql) => Promise<void>;
  listNotes: (execSql: ExecSql) => Promise<NoteSummary[]>;
  listNotesByContainerIdsOrDocumentIds: (
    execSql: ExecSql,
    input: {
      containerIds: ReadonlyArray<string>;
      documentIds: ReadonlyArray<string>;
    },
  ) => Promise<NoteSummary[]>;
  loadNote: (execSql: ExecSql, noteId: string) => Promise<NoteRecord | null>;
  saveNote: (
    execSql: ExecSql,
    note: NoteRecord,
    options?: {
      updatedAt?: string;
    },
  ) => Promise<string>;
  upsertDiscoveredNote: (
    execSql: ExecSql,
    input: DiscoveredNoteInput,
  ) => Promise<NoteSummary>;
  relinkPersistedNote: (
    execSql: ExecSql,
    input: RelinkPersistedNoteInput,
  ) => Promise<NoteSummary | null>;
  listPendingUpdates: (
    execSql: ExecSql,
    noteId: string,
  ) => Promise<PendingUpdateRecord[]>;
  listPendingAttachments: (
    execSql: ExecSql,
    noteId: string,
  ) => Promise<PendingAttachmentRecord[]>;
  listPendingAttachmentRewraps: (
    execSql: ExecSql,
    noteId: string,
  ) => Promise<PendingAttachmentRewrapRecord[]>;
  listPendingAttachmentReplacements: (
    execSql: ExecSql,
    noteId: string,
  ) => Promise<PendingAttachmentReplacementRecord[]>;
  listLocalAttachments: (
    execSql: ExecSql,
    noteId: string,
  ) => Promise<LocalAttachmentRecord[]>;
  enqueuePendingUpdate: (
    execSql: ExecSql,
    pendingUpdate: PendingUpdateInsert,
  ) => Promise<void>;
  saveLocalAttachment: (
    execSql: ExecSql,
    attachment: LocalAttachmentRecord,
  ) => Promise<void>;
  savePendingAttachment: (
    execSql: ExecSql,
    attachment: PendingAttachmentRecord,
  ) => Promise<void>;
  savePendingAttachmentRewrap: (
    execSql: ExecSql,
    attachment: PendingAttachmentRewrapRecord,
  ) => Promise<void>;
  savePendingAttachmentReplacement: (
    execSql: ExecSql,
    attachment: PendingAttachmentReplacementRecord,
  ) => Promise<void>;
  deletePendingUpdate: (execSql: ExecSql, id: string) => Promise<void>;
  deletePendingUpdates: (execSql: ExecSql, noteId: string) => Promise<void>;
  deletePendingAttachments: (execSql: ExecSql, noteId: string) => Promise<void>;
  deletePendingAttachmentRewraps: (
    execSql: ExecSql,
    noteId: string,
  ) => Promise<void>;
  deletePendingAttachmentReplacement: (
    execSql: ExecSql,
    noteId: string,
    slotId: string,
  ) => Promise<void>;
  deletePendingAttachmentReplacements: (
    execSql: ExecSql,
    noteId: string,
  ) => Promise<void>;
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
  {
    name: "note_pending_attachments",
    createSql: `
      CREATE TABLE IF NOT EXISTS note_pending_attachments (
        note_id TEXT NOT NULL,
        slot_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mime_type TEXT,
        storage_key TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (note_id, slot_id)
      )
    `,
  },
  {
    name: "note_attachment_blob_projection",
    createSql: `
      CREATE TABLE IF NOT EXISTS note_attachment_blob_projection (
        note_id TEXT NOT NULL,
        slot_id TEXT NOT NULL,
        blob_id TEXT,
        storage_key TEXT NOT NULL,
        mime_type TEXT,
        byte_length INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (note_id, slot_id)
      )
    `,
  },
  {
    name: "note_pending_attachment_rewraps",
    createSql: `
      CREATE TABLE IF NOT EXISTS note_pending_attachment_rewraps (
        note_id TEXT NOT NULL,
        slot_id TEXT NOT NULL,
        blob_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (note_id, slot_id)
      )
    `,
  },
  {
    name: "note_pending_attachment_replacements",
    createSql: `
      CREATE TABLE IF NOT EXISTS note_pending_attachment_replacements (
        note_id TEXT NOT NULL,
        slot_id TEXT NOT NULL,
        blob_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (note_id, slot_id)
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

function parsePendingAttachmentMimeType(
  row: SqlRow | undefined,
): string | null {
  const mimeType = row ? readSqlRowValue(row, "mime_type") : null;
  return mimeType === null || mimeType === undefined ? null : String(mimeType);
}

function parsePendingAttachmentByteLength(row: SqlRow | undefined): number {
  const byteLength = row ? readSqlRowValue(row, "byte_length") : null;
  return Number(byteLength ?? 0);
}

function parseStorageKey(row: SqlRow | undefined): string {
  const storageKey = row ? readSqlRowValue(row, "storage_key") : null;
  return String(storageKey ?? "");
}

function parseBlobId(row: SqlRow | undefined): string | null {
  const blobId = row ? readSqlRowValue(row, "blob_id") : null;
  return blobId === null || blobId === undefined ? null : String(blobId);
}

function deriveNoteTitle(text: string): string {
  return deriveStoredDocumentTitle(text);
}

function deriveNoteDocumentKind(text: string): StoredDocumentKind {
  return deriveStoredDocumentKind(text);
}

export const deriveDocumentTitle = deriveNoteTitle;
export const deriveDocumentKind = deriveNoteDocumentKind;

function didStoredDocumentContentChange(
  existing: Pick<NoteRecord, "loroSnapshot" | "text"> | null,
  next: Pick<NoteRecord, "loroSnapshot" | "text">,
): boolean {
  return (
    existing === null ||
    existing.loroSnapshot !== next.loroSnapshot ||
    existing.text !== next.text
  );
}

async function upsertDiscoveredNoteWithExec(
  execSql: ExecSql,
  input: DiscoveredNoteInput,
): Promise<NoteSummary> {
  const existingLocalId = await findLocalIdByDocumentId(
    execSql,
    NOTES_APP_KIND,
    input.documentId,
  );
  const noteId = existingLocalId ?? input.documentId;
  const existingNote = await sqlNotesPersistence.loadNote(execSql, noteId);
  const nextContainerId =
    existingNote?.containerId &&
    input.linkedContainerIds.includes(existingNote.containerId)
      ? existingNote.containerId
      : (input.linkedContainerIds.find(
          (linkedContainerId) => linkedContainerId === input.containerId,
        ) ??
        input.linkedContainerIds[0] ??
        input.containerId);

  const nextNote: NoteRecord = {
    id: noteId,
    containerId: nextContainerId,
    documentId: input.documentId,
    documentRecipientEnvelopes:
      input.accessEpoch > (existingNote?.accessEpoch ?? 1)
        ? null
        : (existingNote?.documentRecipientEnvelopes ?? null),
    text: existingNote?.text ?? "",
    loroSnapshot: existingNote?.loroSnapshot ?? "",
    accessEpoch: Math.max(existingNote?.accessEpoch ?? 1, input.accessEpoch),
  };

  const saveOptions =
    existingNote === null || existingNote === undefined
      ? { updatedAt: input.createdAt }
      : undefined;
  const updatedAt = await sqlNotesPersistence.saveNote(
    execSql,
    nextNote,
    saveOptions,
  );

  return {
    id: noteId,
    containerId: nextNote.containerId,
    documentKind: deriveNoteDocumentKind(nextNote.text),
    documentId: nextNote.documentId,
    title: deriveNoteTitle(nextNote.text),
    updatedAt,
  };
}

async function relinkPersistedNoteWithExec(
  execSql: ExecSql,
  input: RelinkPersistedNoteInput,
): Promise<NoteSummary | null> {
  const existingNote = await sqlNotesPersistence.loadNote(
    execSql,
    input.noteId,
  );
  if (!existingNote) {
    return null;
  }

  const nextAccessEpoch = Math.max(existingNote.accessEpoch, input.accessEpoch);
  const nextNote: NoteRecord = {
    ...existingNote,
    accessEpoch: nextAccessEpoch,
    containerId: input.containerId,
    documentId: input.documentId,
    documentRecipientEnvelopes:
      input.accessEpoch > existingNote.accessEpoch
        ? null
        : existingNote.documentRecipientEnvelopes,
  };

  await sqlNotesPersistence.saveNote(execSql, nextNote);

  const updatedAtRows = await execSql(
    `
      SELECT updated_at
      FROM note_projection
      WHERE note_id = :noteId
      LIMIT 1
    `,
    {
      ":noteId": input.noteId,
    },
  );

  return {
    id: nextNote.id,
    containerId: nextNote.containerId,
    documentKind: deriveNoteDocumentKind(nextNote.text),
    documentId: nextNote.documentId,
    title: deriveNoteTitle(nextNote.text),
    updatedAt: parseProjectionUpdatedAt(updatedAtRows[0]),
  };
}

async function upsertDiscoveredNotes(
  execSql: ExecSql,
  inputs: ReadonlyArray<DiscoveredNoteInput>,
): Promise<NoteSummary[]> {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await sqlNotesPersistence.ensureSchema(lockedExecSql);
    const nextSummaries: NoteSummary[] = [];

    for (const input of inputs) {
      nextSummaries.push(
        await upsertDiscoveredNoteWithExec(lockedExecSql, input),
      );
    }

    return nextSummaries;
  });
}

export const upsertDiscoveredDocuments = upsertDiscoveredNotes;

async function listNotesByContainerIds(
  execSql: ExecSql,
  containerIds: ReadonlyArray<string>,
): Promise<NoteSummary[]> {
  const uniqueContainerIds = [...new Set(containerIds)];

  if (uniqueContainerIds.length === 0) {
    return [];
  }

  const bind: Record<string, string> = {};
  const placeholders = uniqueContainerIds.map((containerId, index) => {
    const key = `:containerId${index}`;
    bind[key] = containerId;
    return key;
  });

  const rows = await execSql(
    `
      SELECT
        note_id,
        document_id,
        container_id,
        text,
        updated_at
      FROM note_projection
      WHERE container_id IN (${placeholders.join(", ")})
      ORDER BY updated_at DESC, note_id DESC
    `,
    bind,
  );

  return rows.map((row) => ({
    id: String(readSqlRowValue(row, "note_id") ?? ""),
    containerId: parseProjectionContainerId(row),
    documentKind: deriveNoteDocumentKind(parseProjectionText(row)),
    documentId: parseProjectionDocumentId(row),
    title: deriveNoteTitle(parseProjectionText(row)),
    updatedAt: parseProjectionUpdatedAt(row),
  }));
}

export const listDocumentsByContainerIds = listNotesByContainerIds;

async function listNotesByContainerIdsOrDocumentIds(
  execSql: ExecSql,
  input: {
    containerIds: ReadonlyArray<string>;
    documentIds: ReadonlyArray<string>;
  },
): Promise<NoteSummary[]> {
  const uniqueContainerIds = Array.from(new Set(input.containerIds));
  const uniqueDocumentIds = Array.from(new Set(input.documentIds));
  if (uniqueContainerIds.length === 0 && uniqueDocumentIds.length === 0) {
    return [];
  }

  const bind: Record<string, string> = {};
  const filters: string[] = [];
  if (uniqueContainerIds.length > 0) {
    const placeholders = uniqueContainerIds.map((containerId, index) => {
      const key = `:containerId${index}`;
      bind[key] = containerId;
      return key;
    });
    filters.push(`container_id IN (${placeholders.join(", ")})`);
  }

  if (uniqueDocumentIds.length > 0) {
    const placeholders = uniqueDocumentIds.map((documentId, index) => {
      const key = `:documentId${index}`;
      bind[key] = documentId;
      return key;
    });
    filters.push(`document_id IN (${placeholders.join(", ")})`);
  }

  const rows = await execSql(
    `
      SELECT
        note_id,
        document_id,
        container_id,
        text,
        updated_at
      FROM note_projection
      WHERE ${filters.join(" OR ")}
      ORDER BY updated_at DESC, note_id DESC
    `,
    bind,
  );

  return rows.map((row) => ({
    id: String(readSqlRowValue(row, "note_id") ?? ""),
    containerId: parseProjectionContainerId(row),
    documentKind: deriveNoteDocumentKind(parseProjectionText(row)),
    documentId: parseProjectionDocumentId(row),
    title: deriveNoteTitle(parseProjectionText(row)),
    updatedAt: parseProjectionUpdatedAt(row),
  }));
}

const listDocumentsByContainerIdsOrDocumentIds =
  listNotesByContainerIdsOrDocumentIds;

const sqlNotesPersistence: NotesPersistence = {
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
        ORDER BY updated_at DESC, note_id DESC
      `,
    );

    return rows.map((row) => ({
      id: String(readSqlRowValue(row, "note_id") ?? ""),
      containerId: parseProjectionContainerId(row),
      documentKind: deriveNoteDocumentKind(parseProjectionText(row)),
      documentId: parseProjectionDocumentId(row),
      title: deriveNoteTitle(parseProjectionText(row)),
      updatedAt: parseProjectionUpdatedAt(row),
    }));
  },
  listNotesByContainerIdsOrDocumentIds,
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
  async saveNote(execSql, note, options) {
    return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
      runSqlTransaction(lockedExecSql, async () => {
        const [existingRecord, projectionRows] = await Promise.all([
          loadDocumentRecord(lockedExecSql, getNoteScope(note.id)),
          lockedExecSql(
            `
              SELECT
                text,
                updated_at
              FROM note_projection
              WHERE note_id = :noteId
              LIMIT 1
            `,
            {
              ":noteId": note.id,
            },
          ),
        ]);
        const existingProjection = projectionRows[0];
        const updatedAt =
          options?.updatedAt ??
          (didStoredDocumentContentChange(
            existingRecord
              ? {
                  loroSnapshot: existingRecord.loroSnapshot,
                  text: parseProjectionText(existingProjection),
                }
              : null,
            note,
          )
            ? new Date().toISOString()
            : parseProjectionUpdatedAt(existingProjection) ||
              new Date().toISOString());

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

        return updatedAt;
      }),
    );
  },
  async upsertDiscoveredNote(execSql, input) {
    const [nextSummary] = await upsertDiscoveredNotes(execSql, [input]);
    if (!nextSummary) {
      throw new Error("Failed to upsert discovered note");
    }

    return nextSummary;
  },
  async relinkPersistedNote(execSql, input) {
    return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await sqlNotesPersistence.ensureSchema(lockedExecSql);
      return relinkPersistedNoteWithExec(lockedExecSql, input);
    });
  },
  async listPendingUpdates(execSql, noteId) {
    return listDocumentPendingUpdates(execSql, getNoteScope(noteId));
  },
  async listPendingAttachments(execSql, noteId) {
    const rows = await execSql(
      `
        SELECT
          note_id,
          slot_id,
          name,
          mime_type,
          storage_key,
          byte_length
        FROM note_pending_attachments
        WHERE note_id = :noteId
        ORDER BY created_at, slot_id
      `,
      {
        ":noteId": noteId,
      },
    );

    return rows.map((row) => ({
      byteLength: parsePendingAttachmentByteLength(row),
      mimeType: parsePendingAttachmentMimeType(row),
      name: String(readSqlRowValue(row, "name") ?? ""),
      noteId: String(readSqlRowValue(row, "note_id") ?? ""),
      slotId: String(readSqlRowValue(row, "slot_id") ?? ""),
      storageKey: parseStorageKey(row),
    }));
  },
  async listPendingAttachmentRewraps(execSql, noteId) {
    const rows = await execSql(
      `
        SELECT
          note_id,
          slot_id,
          blob_id
        FROM note_pending_attachment_rewraps
        WHERE note_id = :noteId
        ORDER BY created_at, slot_id
      `,
      {
        ":noteId": noteId,
      },
    );

    return rows.map((row) => ({
      blobId: String(readSqlRowValue(row, "blob_id") ?? ""),
      noteId: String(readSqlRowValue(row, "note_id") ?? ""),
      slotId: String(readSqlRowValue(row, "slot_id") ?? ""),
    }));
  },
  async listPendingAttachmentReplacements(execSql, noteId) {
    const rows = await execSql(
      `
        SELECT
          note_id,
          slot_id,
          blob_id
        FROM note_pending_attachment_replacements
        WHERE note_id = :noteId
        ORDER BY created_at, slot_id
      `,
      {
        ":noteId": noteId,
      },
    );

    return rows.map((row) => ({
      blobId: parseBlobId(row),
      noteId: String(readSqlRowValue(row, "note_id") ?? ""),
      slotId: String(readSqlRowValue(row, "slot_id") ?? ""),
    }));
  },
  async listLocalAttachments(execSql, noteId) {
    const rows = await execSql(
      `
        SELECT
          note_id,
          slot_id,
          blob_id,
          storage_key,
          mime_type,
          byte_length
        FROM note_attachment_blob_projection
        WHERE note_id = :noteId
      `,
      {
        ":noteId": noteId,
      },
    );

    return rows.map((row) => ({
      blobId: parseBlobId(row),
      byteLength: parsePendingAttachmentByteLength(row),
      mimeType: parsePendingAttachmentMimeType(row),
      noteId: String(readSqlRowValue(row, "note_id") ?? ""),
      slotId: String(readSqlRowValue(row, "slot_id") ?? ""),
      storageKey: parseStorageKey(row),
    }));
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
  async saveLocalAttachment(execSql, attachment) {
    const updatedAt = new Date().toISOString();

    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await lockedExecSql(
        `
          INSERT INTO note_attachment_blob_projection (
            note_id,
            slot_id,
            blob_id,
            storage_key,
            mime_type,
            byte_length,
            updated_at
          )
          VALUES (
            :noteId,
            :slotId,
            :blobId,
            :storageKey,
            :mimeType,
            :byteLength,
            :updatedAt
          )
          ON CONFLICT(note_id, slot_id) DO UPDATE SET
            blob_id = excluded.blob_id,
            storage_key = excluded.storage_key,
            mime_type = excluded.mime_type,
            byte_length = excluded.byte_length,
            updated_at = excluded.updated_at
        `,
        {
          ":noteId": attachment.noteId,
          ":slotId": attachment.slotId,
          ":blobId": attachment.blobId,
          ":storageKey": attachment.storageKey,
          ":mimeType": attachment.mimeType,
          ":byteLength": attachment.byteLength,
          ":updatedAt": updatedAt,
        },
      );
    });
  },
  async savePendingAttachment(execSql, attachment) {
    const createdAt = new Date().toISOString();

    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await lockedExecSql(
        `
          INSERT INTO note_pending_attachments (
            note_id,
            slot_id,
            name,
            mime_type,
            storage_key,
            byte_length,
            created_at
          )
          VALUES (
            :noteId,
            :slotId,
            :name,
            :mimeType,
            :storageKey,
            :byteLength,
            :createdAt
          )
          ON CONFLICT(note_id, slot_id) DO UPDATE SET
            name = excluded.name,
            mime_type = excluded.mime_type,
            storage_key = excluded.storage_key,
            byte_length = excluded.byte_length
        `,
        {
          ":noteId": attachment.noteId,
          ":slotId": attachment.slotId,
          ":name": attachment.name,
          ":mimeType": attachment.mimeType,
          ":storageKey": attachment.storageKey,
          ":byteLength": attachment.byteLength,
          ":createdAt": createdAt,
        },
      );
    });
  },
  async savePendingAttachmentRewrap(execSql, attachment) {
    const createdAt = new Date().toISOString();

    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await lockedExecSql(
        `
          INSERT INTO note_pending_attachment_rewraps (
            note_id,
            slot_id,
            blob_id,
            created_at
          )
          VALUES (
            :noteId,
            :slotId,
            :blobId,
            :createdAt
          )
          ON CONFLICT(note_id, slot_id) DO UPDATE SET
            blob_id = excluded.blob_id
        `,
        {
          ":noteId": attachment.noteId,
          ":slotId": attachment.slotId,
          ":blobId": attachment.blobId,
          ":createdAt": createdAt,
        },
      );
    });
  },
  async savePendingAttachmentReplacement(execSql, attachment) {
    const createdAt = new Date().toISOString();

    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await lockedExecSql(
        `
          INSERT INTO note_pending_attachment_replacements (
            note_id,
            slot_id,
            blob_id,
            created_at
          )
          VALUES (
            :noteId,
            :slotId,
            :blobId,
            :createdAt
          )
          ON CONFLICT(note_id, slot_id) DO UPDATE SET
            blob_id = excluded.blob_id
        `,
        {
          ":noteId": attachment.noteId,
          ":slotId": attachment.slotId,
          ":blobId": attachment.blobId,
          ":createdAt": createdAt,
        },
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
  async deletePendingAttachments(execSql, noteId) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await lockedExecSql(
        `
          DELETE FROM note_pending_attachments
          WHERE note_id = :noteId
        `,
        {
          ":noteId": noteId,
        },
      );
    });
  },
  async deletePendingAttachmentRewraps(execSql, noteId) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await lockedExecSql(
        `
          DELETE FROM note_pending_attachment_rewraps
          WHERE note_id = :noteId
        `,
        {
          ":noteId": noteId,
        },
      );
    });
  },
  async deletePendingAttachmentReplacement(execSql, noteId, slotId) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await lockedExecSql(
        `
          DELETE FROM note_pending_attachment_replacements
          WHERE note_id = :noteId AND slot_id = :slotId
        `,
        {
          ":noteId": noteId,
          ":slotId": slotId,
        },
      );
    });
  },
  async deletePendingAttachmentReplacements(execSql, noteId) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await lockedExecSql(
        `
          DELETE FROM note_pending_attachment_replacements
          WHERE note_id = :noteId
        `,
        {
          ":noteId": noteId,
        },
      );
    });
  },
};

export const sqlDocumentsPersistence: DocumentsPersistence = {
  deletePendingAttachmentReplacement:
    sqlNotesPersistence.deletePendingAttachmentReplacement,
  deletePendingAttachmentReplacements:
    sqlNotesPersistence.deletePendingAttachmentReplacements,
  deletePendingAttachmentRewraps:
    sqlNotesPersistence.deletePendingAttachmentRewraps,
  deletePendingAttachments: sqlNotesPersistence.deletePendingAttachments,
  deletePendingUpdate: sqlNotesPersistence.deletePendingUpdate,
  deletePendingUpdates: sqlNotesPersistence.deletePendingUpdates,
  ensureSchema: sqlNotesPersistence.ensureSchema,
  enqueuePendingUpdate: sqlNotesPersistence.enqueuePendingUpdate,
  listLocalAttachments: sqlNotesPersistence.listLocalAttachments,
  listPendingAttachmentReplacements:
    sqlNotesPersistence.listPendingAttachmentReplacements,
  listPendingAttachmentRewraps:
    sqlNotesPersistence.listPendingAttachmentRewraps,
  listPendingAttachments: sqlNotesPersistence.listPendingAttachments,
  listPendingUpdates: sqlNotesPersistence.listPendingUpdates,
  loadNote: sqlNotesPersistence.loadNote,
  listNotes: sqlNotesPersistence.listNotes,
  listNotesByContainerIdsOrDocumentIds:
    listDocumentsByContainerIdsOrDocumentIds,
  relinkPersistedNote: sqlNotesPersistence.relinkPersistedNote,
  saveLocalAttachment: sqlNotesPersistence.saveLocalAttachment,
  saveNote: sqlNotesPersistence.saveNote,
  savePendingAttachment: sqlNotesPersistence.savePendingAttachment,
  savePendingAttachmentReplacement:
    sqlNotesPersistence.savePendingAttachmentReplacement,
  savePendingAttachmentRewrap: sqlNotesPersistence.savePendingAttachmentRewrap,
  upsertDiscoveredNote: sqlNotesPersistence.upsertDiscoveredNote,
};
