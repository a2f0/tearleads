import {
  type DocumentRecord as BaseDocumentRecord,
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
} from "../persistence/documentPersistence";
import type { SqlRow } from "../persistence/sqlSchema";
import {
  type ExecSql,
  ensureSqlTables,
  readSqlRowValue,
  runSerializedSqlMutation,
  runSqlTransaction,
  type SqlTableSchema,
} from "../persistence/sqlSchema";
import {
  deriveStoredDocumentKind,
  deriveStoredDocumentTitle,
  type StoredDocumentKind,
} from "./documentKinds";

export type { PendingUpdateRecord } from "../persistence/documentPersistence";

export interface StoredDocumentRecord extends BaseDocumentRecord {
  containerId: string | null;
  text: string;
}

export interface DocumentSummary {
  accessStateHash?: string | null;
  id: string;
  containerId: string | null;
  documentKind?: StoredDocumentKind;
  documentId: string | null;
  title: string;
  updatedAt: string;
}

export interface PendingUpdateInsert extends PendingUpdateFields {
  localId: string;
}

export interface PendingAttachmentRecord {
  byteLength: number;
  localId: string;
  mimeType: string | null;
  name: string;
  slotId: string;
  storageKey: string;
}

export interface PendingAttachmentRewrapRecord {
  blobId: string;
  localId: string;
  slotId: string;
}

export interface PendingAttachmentReplacementRecord {
  blobId: string | null;
  localId: string;
  slotId: string;
}

export interface LocalAttachmentRecord {
  blobId: string | null;
  byteLength: number;
  localId: string;
  mimeType: string | null;
  slotId: string;
  storageKey: string;
}

export interface DiscoveredDocumentInput {
  accessEpoch: number;
  accessStateHash?: string | null;
  containerId: string;
  createdAt: string;
  documentId: string;
  linkedContainerIds: ReadonlyArray<string>;
}

export interface RelinkPersistedDocumentInput {
  accessEpoch: number;
  accessStateHash?: string | null;
  containerId: string;
  documentId: string;
  localId: string;
}

export interface DocumentsPersistence {
  ensureSchema: (execSql: ExecSql) => Promise<void>;
  listDocuments: (execSql: ExecSql) => Promise<DocumentSummary[]>;
  listDocumentsByContainerIdsOrDocumentIds: (
    execSql: ExecSql,
    input: {
      containerIds: ReadonlyArray<string>;
      documentIds: ReadonlyArray<string>;
    },
  ) => Promise<DocumentSummary[]>;
  loadDocument: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<StoredDocumentRecord | null>;
  saveDocument: (
    execSql: ExecSql,
    document: StoredDocumentRecord,
    options?: {
      updatedAt?: string;
    },
  ) => Promise<string>;
  upsertDiscoveredDocument: (
    execSql: ExecSql,
    input: DiscoveredDocumentInput,
  ) => Promise<DocumentSummary>;
  relinkPersistedDocument: (
    execSql: ExecSql,
    input: RelinkPersistedDocumentInput,
  ) => Promise<DocumentSummary | null>;
  listPendingUpdates: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<PendingUpdateRecord[]>;
  listPendingAttachments: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<PendingAttachmentRecord[]>;
  listPendingAttachmentRewraps: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<PendingAttachmentRewrapRecord[]>;
  listPendingAttachmentReplacements: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<PendingAttachmentReplacementRecord[]>;
  listLocalAttachments: (
    execSql: ExecSql,
    localId: string,
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
  deletePendingUpdates: (execSql: ExecSql, localId: string) => Promise<void>;
  deletePendingAttachments: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<void>;
  deletePendingAttachmentRewraps: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<void>;
  deletePendingAttachmentReplacement: (
    execSql: ExecSql,
    localId: string,
    slotId: string,
  ) => Promise<void>;
  deletePendingAttachmentReplacements: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<void>;
}

export const DOCUMENTS_APP_KIND = "documents";

const documentProjectionTables: ReadonlyArray<SqlTableSchema> = [
  {
    name: "document_projection",
    createSql: `
      CREATE TABLE IF NOT EXISTS document_projection (
        local_id TEXT PRIMARY KEY,
        document_id TEXT,
        container_id TEXT,
        text TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
  },
  {
    name: "document_pending_attachments",
    createSql: `
      CREATE TABLE IF NOT EXISTS document_pending_attachments (
        local_id TEXT NOT NULL,
        slot_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mime_type TEXT,
        storage_key TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (local_id, slot_id)
      )
    `,
  },
  {
    name: "document_attachment_blob_projection",
    createSql: `
      CREATE TABLE IF NOT EXISTS document_attachment_blob_projection (
        local_id TEXT NOT NULL,
        slot_id TEXT NOT NULL,
        blob_id TEXT,
        storage_key TEXT NOT NULL,
        mime_type TEXT,
        byte_length INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (local_id, slot_id)
      )
    `,
  },
  {
    name: "document_pending_attachment_rewraps",
    createSql: `
      CREATE TABLE IF NOT EXISTS document_pending_attachment_rewraps (
        local_id TEXT NOT NULL,
        slot_id TEXT NOT NULL,
        blob_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (local_id, slot_id)
      )
    `,
  },
  {
    name: "document_pending_attachment_replacements",
    createSql: `
      CREATE TABLE IF NOT EXISTS document_pending_attachment_replacements (
        local_id TEXT NOT NULL,
        slot_id TEXT NOT NULL,
        blob_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (local_id, slot_id)
      )
    `,
  },
];

function getDocumentScope(localId: string): DocumentScope {
  return {
    appKind: DOCUMENTS_APP_KIND,
    localId,
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

function parseProjectionAccessStateHash(
  row: SqlRow | undefined,
): string | null {
  const accessStateHash = row
    ? readSqlRowValue(row, "access_state_hash")
    : null;
  return accessStateHash === null || accessStateHash === undefined
    ? null
    : String(accessStateHash);
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

function derivePersistedDocumentTitle(text: string): string {
  return deriveStoredDocumentTitle(text);
}

function derivePersistedDocumentKind(text: string): StoredDocumentKind {
  return deriveStoredDocumentKind(text);
}

export const deriveDocumentTitle = derivePersistedDocumentTitle;
export const deriveDocumentKind = derivePersistedDocumentKind;

function didStoredDocumentContentChange(
  existing: Pick<StoredDocumentRecord, "loroSnapshot" | "text"> | null,
  next: Pick<StoredDocumentRecord, "loroSnapshot" | "text">,
): boolean {
  return (
    existing === null ||
    existing.loroSnapshot !== next.loroSnapshot ||
    existing.text !== next.text
  );
}

async function upsertDiscoveredDocumentWithExec(
  execSql: ExecSql,
  input: DiscoveredDocumentInput,
): Promise<DocumentSummary> {
  const existingLocalId = await findLocalIdByDocumentId(
    execSql,
    DOCUMENTS_APP_KIND,
    input.documentId,
  );
  const localId = existingLocalId ?? input.documentId;
  const existingDocument = await sqlDocumentsPersistence.loadDocument(
    execSql,
    localId,
  );
  const nextContainerId =
    existingDocument?.containerId &&
    input.linkedContainerIds.includes(existingDocument.containerId)
      ? existingDocument.containerId
      : (input.linkedContainerIds.find(
          (linkedContainerId) => linkedContainerId === input.containerId,
        ) ??
        input.linkedContainerIds[0] ??
        input.containerId);

  const nextDocument: StoredDocumentRecord = {
    id: localId,
    containerId: nextContainerId,
    documentId: input.documentId,
    documentRecipientEnvelopes:
      input.accessEpoch > (existingDocument?.accessEpoch ?? 1)
        ? null
        : (existingDocument?.documentRecipientEnvelopes ?? null),
    text: existingDocument?.text ?? "",
    loroSnapshot: existingDocument?.loroSnapshot ?? "",
    accessEpoch: Math.max(
      existingDocument?.accessEpoch ?? 1,
      input.accessEpoch,
    ),
    accessStateHash:
      input.accessStateHash === undefined
        ? (existingDocument?.accessStateHash ?? null)
        : input.accessStateHash,
    lastCommitLsn:
      existingDocument?.documentId === input.documentId
        ? (existingDocument.lastCommitLsn ?? null)
        : null,
  };

  const saveOptions =
    existingDocument === null || existingDocument === undefined
      ? { updatedAt: input.createdAt }
      : undefined;
  const updatedAt = await sqlDocumentsPersistence.saveDocument(
    execSql,
    nextDocument,
    saveOptions,
  );

  return {
    accessStateHash: nextDocument.accessStateHash ?? null,
    id: localId,
    containerId: nextDocument.containerId,
    documentKind: derivePersistedDocumentKind(nextDocument.text),
    documentId: nextDocument.documentId,
    title: derivePersistedDocumentTitle(nextDocument.text),
    updatedAt,
  };
}

async function relinkPersistedDocumentWithExec(
  execSql: ExecSql,
  input: RelinkPersistedDocumentInput,
): Promise<DocumentSummary | null> {
  const existingDocument = await sqlDocumentsPersistence.loadDocument(
    execSql,
    input.localId,
  );
  if (!existingDocument) {
    return null;
  }

  const nextAccessEpoch = Math.max(
    existingDocument.accessEpoch,
    input.accessEpoch,
  );
  const nextDocument: StoredDocumentRecord = {
    ...existingDocument,
    accessEpoch: nextAccessEpoch,
    accessStateHash:
      input.accessStateHash === undefined
        ? (existingDocument.accessStateHash ?? null)
        : input.accessStateHash,
    containerId: input.containerId,
    documentId: input.documentId,
    documentRecipientEnvelopes:
      input.accessEpoch > existingDocument.accessEpoch
        ? null
        : existingDocument.documentRecipientEnvelopes,
    lastCommitLsn:
      existingDocument.documentId === input.documentId
        ? (existingDocument.lastCommitLsn ?? null)
        : null,
  };

  await sqlDocumentsPersistence.saveDocument(execSql, nextDocument);

  const updatedAtRows = await execSql(
    `
      SELECT updated_at
      FROM document_projection
      WHERE local_id = :localId
      LIMIT 1
    `,
    {
      ":localId": input.localId,
    },
  );

  return {
    accessStateHash: nextDocument.accessStateHash ?? null,
    id: nextDocument.id,
    containerId: nextDocument.containerId,
    documentKind: derivePersistedDocumentKind(nextDocument.text),
    documentId: nextDocument.documentId,
    title: derivePersistedDocumentTitle(nextDocument.text),
    updatedAt: parseProjectionUpdatedAt(updatedAtRows[0]),
  };
}

export async function upsertDiscoveredDocuments(
  execSql: ExecSql,
  inputs: ReadonlyArray<DiscoveredDocumentInput>,
): Promise<DocumentSummary[]> {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await sqlDocumentsPersistence.ensureSchema(lockedExecSql);
    const nextSummaries: DocumentSummary[] = [];

    for (const input of inputs) {
      nextSummaries.push(
        await upsertDiscoveredDocumentWithExec(lockedExecSql, input),
      );
    }

    return nextSummaries;
  });
}

export async function listDocumentsByContainerIds(
  execSql: ExecSql,
  containerIds: ReadonlyArray<string>,
): Promise<DocumentSummary[]> {
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
        projection.local_id,
        projection.document_id,
        projection.container_id,
        projection.text,
        projection.updated_at,
        persisted.access_state_hash
      FROM document_projection projection
      LEFT JOIN documents persisted
        ON persisted.app_kind = :appKind
       AND persisted.local_id = projection.local_id
      WHERE projection.container_id IN (${placeholders.join(", ")})
      ORDER BY projection.updated_at DESC, projection.local_id DESC
    `,
    {
      ...bind,
      ":appKind": DOCUMENTS_APP_KIND,
    },
  );

  return rows.map((row) => ({
    accessStateHash: parseProjectionAccessStateHash(row),
    id: String(readSqlRowValue(row, "local_id") ?? ""),
    containerId: parseProjectionContainerId(row),
    documentKind: derivePersistedDocumentKind(parseProjectionText(row)),
    documentId: parseProjectionDocumentId(row),
    title: derivePersistedDocumentTitle(parseProjectionText(row)),
    updatedAt: parseProjectionUpdatedAt(row),
  }));
}

async function listDocumentsByContainerIdsOrDocumentIds(
  execSql: ExecSql,
  input: {
    containerIds: ReadonlyArray<string>;
    documentIds: ReadonlyArray<string>;
  },
): Promise<DocumentSummary[]> {
  const uniqueContainerIds = Array.from(new Set(input.containerIds));
  const uniqueDocumentIds = Array.from(new Set(input.documentIds));
  if (uniqueContainerIds.length === 0 && uniqueDocumentIds.length === 0) {
    return [];
  }

  const bind: Record<string, string> = {};
  bind[":appKind"] = DOCUMENTS_APP_KIND;
  const filters: string[] = [];
  if (uniqueContainerIds.length > 0) {
    const placeholders = uniqueContainerIds.map((containerId, index) => {
      const key = `:containerId${index}`;
      bind[key] = containerId;
      return key;
    });
    filters.push(`projection.container_id IN (${placeholders.join(", ")})`);
  }

  if (uniqueDocumentIds.length > 0) {
    const placeholders = uniqueDocumentIds.map((documentId, index) => {
      const key = `:documentId${index}`;
      bind[key] = documentId;
      return key;
    });
    filters.push(`projection.document_id IN (${placeholders.join(", ")})`);
  }

  const rows = await execSql(
    `
      SELECT
        projection.local_id,
        projection.document_id,
        projection.container_id,
        projection.text,
        projection.updated_at,
        persisted.access_state_hash
      FROM document_projection projection
      LEFT JOIN documents persisted
        ON persisted.app_kind = :appKind
       AND persisted.local_id = projection.local_id
      WHERE ${filters.join(" OR ")}
      ORDER BY projection.updated_at DESC, projection.local_id DESC
    `,
    bind,
  );

  return rows.map((row) => ({
    accessStateHash: parseProjectionAccessStateHash(row),
    id: String(readSqlRowValue(row, "local_id") ?? ""),
    containerId: parseProjectionContainerId(row),
    documentKind: derivePersistedDocumentKind(parseProjectionText(row)),
    documentId: parseProjectionDocumentId(row),
    title: derivePersistedDocumentTitle(parseProjectionText(row)),
    updatedAt: parseProjectionUpdatedAt(row),
  }));
}

const sqlStoredDocumentsPersistence: DocumentsPersistence = {
  async ensureSchema(execSql) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await ensureDocumentTables(lockedExecSql);
      await ensureSqlTables(lockedExecSql, documentProjectionTables);
    });
  },
  async listDocuments(execSql) {
    const rows = await execSql(
      `
        SELECT
          projection.local_id,
          projection.document_id,
          projection.container_id,
          projection.text,
          projection.updated_at,
          persisted.access_state_hash
        FROM document_projection projection
        LEFT JOIN documents persisted
          ON persisted.app_kind = :appKind
         AND persisted.local_id = projection.local_id
        ORDER BY projection.updated_at DESC, projection.local_id DESC
      `,
      {
        ":appKind": DOCUMENTS_APP_KIND,
      },
    );

    return rows.map((row) => ({
      accessStateHash: parseProjectionAccessStateHash(row),
      id: String(readSqlRowValue(row, "local_id") ?? ""),
      containerId: parseProjectionContainerId(row),
      documentKind: derivePersistedDocumentKind(parseProjectionText(row)),
      documentId: parseProjectionDocumentId(row),
      title: derivePersistedDocumentTitle(parseProjectionText(row)),
      updatedAt: parseProjectionUpdatedAt(row),
    }));
  },
  listDocumentsByContainerIdsOrDocumentIds,
  async loadDocument(execSql, localId) {
    const [documentRecord, projectionRows] = await Promise.all([
      loadDocumentRecord(execSql, getDocumentScope(localId)),
      execSql(
        `
          SELECT
            text,
            container_id
          FROM document_projection
          WHERE local_id = :localId
          LIMIT 1
        `,
        {
          ":localId": localId,
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
  async saveDocument(execSql, document, options) {
    return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
      runSqlTransaction(lockedExecSql, async () => {
        const [existingRecord, projectionRows] = await Promise.all([
          loadDocumentRecord(lockedExecSql, getDocumentScope(document.id)),
          lockedExecSql(
            `
              SELECT
                text,
                updated_at
              FROM document_projection
              WHERE local_id = :localId
              LIMIT 1
            `,
            {
              ":localId": document.id,
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
            document,
          )
            ? new Date().toISOString()
            : parseProjectionUpdatedAt(existingProjection) ||
              new Date().toISOString());

        await saveDocumentRecord(
          lockedExecSql,
          getDocumentScope(document.id),
          document,
          updatedAt,
        );
        await lockedExecSql(
          `
            INSERT INTO document_projection (
              local_id,
              document_id,
              container_id,
              text,
              updated_at
            )
            VALUES (
              :localId,
              :documentId,
              :containerId,
              :text,
              :updatedAt
            )
            ON CONFLICT(local_id) DO UPDATE SET
              document_id = excluded.document_id,
              container_id = excluded.container_id,
              text = excluded.text,
              updated_at = excluded.updated_at
          `,
          {
            ":localId": document.id,
            ":documentId": document.documentId,
            ":containerId": document.containerId,
            ":text": document.text,
            ":updatedAt": updatedAt,
          },
        );

        return updatedAt;
      }),
    );
  },
  async upsertDiscoveredDocument(execSql, input) {
    const [nextSummary] = await upsertDiscoveredDocuments(execSql, [input]);
    if (!nextSummary) {
      throw new Error("Failed to upsert discovered document");
    }

    return nextSummary;
  },
  async relinkPersistedDocument(execSql, input) {
    return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await sqlStoredDocumentsPersistence.ensureSchema(lockedExecSql);
      return relinkPersistedDocumentWithExec(lockedExecSql, input);
    });
  },
  async listPendingUpdates(execSql, localId) {
    return listDocumentPendingUpdates(execSql, getDocumentScope(localId));
  },
  async listPendingAttachments(execSql, localId) {
    const rows = await execSql(
      `
        SELECT
          local_id,
          slot_id,
          name,
          mime_type,
          storage_key,
          byte_length
        FROM document_pending_attachments
        WHERE local_id = :localId
        ORDER BY created_at, slot_id
      `,
      {
        ":localId": localId,
      },
    );

    return rows.map((row) => ({
      byteLength: parsePendingAttachmentByteLength(row),
      localId: String(readSqlRowValue(row, "local_id") ?? ""),
      mimeType: parsePendingAttachmentMimeType(row),
      name: String(readSqlRowValue(row, "name") ?? ""),
      slotId: String(readSqlRowValue(row, "slot_id") ?? ""),
      storageKey: parseStorageKey(row),
    }));
  },
  async listPendingAttachmentRewraps(execSql, localId) {
    const rows = await execSql(
      `
        SELECT
          local_id,
          slot_id,
          blob_id
        FROM document_pending_attachment_rewraps
        WHERE local_id = :localId
        ORDER BY created_at, slot_id
      `,
      {
        ":localId": localId,
      },
    );

    return rows.map((row) => ({
      blobId: String(readSqlRowValue(row, "blob_id") ?? ""),
      localId: String(readSqlRowValue(row, "local_id") ?? ""),
      slotId: String(readSqlRowValue(row, "slot_id") ?? ""),
    }));
  },
  async listPendingAttachmentReplacements(execSql, localId) {
    const rows = await execSql(
      `
        SELECT
          local_id,
          slot_id,
          blob_id
        FROM document_pending_attachment_replacements
        WHERE local_id = :localId
        ORDER BY created_at, slot_id
      `,
      {
        ":localId": localId,
      },
    );

    return rows.map((row) => ({
      blobId: parseBlobId(row),
      localId: String(readSqlRowValue(row, "local_id") ?? ""),
      slotId: String(readSqlRowValue(row, "slot_id") ?? ""),
    }));
  },
  async listLocalAttachments(execSql, localId) {
    const rows = await execSql(
      `
        SELECT
          local_id,
          slot_id,
          blob_id,
          storage_key,
          mime_type,
          byte_length
        FROM document_attachment_blob_projection
        WHERE local_id = :localId
      `,
      {
        ":localId": localId,
      },
    );

    return rows.map((row) => ({
      blobId: parseBlobId(row),
      byteLength: parsePendingAttachmentByteLength(row),
      localId: String(readSqlRowValue(row, "local_id") ?? ""),
      mimeType: parsePendingAttachmentMimeType(row),
      slotId: String(readSqlRowValue(row, "slot_id") ?? ""),
      storageKey: parseStorageKey(row),
    }));
  },
  async enqueuePendingUpdate(execSql, pendingUpdate) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await enqueueDocumentPendingUpdate(
        lockedExecSql,
        getDocumentScope(pendingUpdate.localId),
        pendingUpdate,
      );
    });
  },
  async saveLocalAttachment(execSql, attachment) {
    const updatedAt = new Date().toISOString();

    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await lockedExecSql(
        `
          INSERT INTO document_attachment_blob_projection (
            local_id,
            slot_id,
            blob_id,
            storage_key,
            mime_type,
            byte_length,
            updated_at
          )
          VALUES (
            :localId,
            :slotId,
            :blobId,
            :storageKey,
            :mimeType,
            :byteLength,
            :updatedAt
          )
          ON CONFLICT(local_id, slot_id) DO UPDATE SET
            blob_id = excluded.blob_id,
            storage_key = excluded.storage_key,
            mime_type = excluded.mime_type,
            byte_length = excluded.byte_length,
            updated_at = excluded.updated_at
        `,
        {
          ":localId": attachment.localId,
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
          INSERT INTO document_pending_attachments (
            local_id,
            slot_id,
            name,
            mime_type,
            storage_key,
            byte_length,
            created_at
          )
          VALUES (
            :localId,
            :slotId,
            :name,
            :mimeType,
            :storageKey,
            :byteLength,
            :createdAt
          )
          ON CONFLICT(local_id, slot_id) DO UPDATE SET
            name = excluded.name,
            mime_type = excluded.mime_type,
            storage_key = excluded.storage_key,
            byte_length = excluded.byte_length
        `,
        {
          ":localId": attachment.localId,
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
          INSERT INTO document_pending_attachment_rewraps (
            local_id,
            slot_id,
            blob_id,
            created_at
          )
          VALUES (
            :localId,
            :slotId,
            :blobId,
            :createdAt
          )
          ON CONFLICT(local_id, slot_id) DO UPDATE SET
            blob_id = excluded.blob_id
        `,
        {
          ":localId": attachment.localId,
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
          INSERT INTO document_pending_attachment_replacements (
            local_id,
            slot_id,
            blob_id,
            created_at
          )
          VALUES (
            :localId,
            :slotId,
            :blobId,
            :createdAt
          )
          ON CONFLICT(local_id, slot_id) DO UPDATE SET
            blob_id = excluded.blob_id
        `,
        {
          ":localId": attachment.localId,
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
  async deletePendingUpdates(execSql, localId) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await deleteDocumentPendingUpdates(
        lockedExecSql,
        getDocumentScope(localId),
      );
    });
  },
  async deletePendingAttachments(execSql, localId) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await lockedExecSql(
        `
          DELETE FROM document_pending_attachments
          WHERE local_id = :localId
        `,
        {
          ":localId": localId,
        },
      );
    });
  },
  async deletePendingAttachmentRewraps(execSql, localId) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await lockedExecSql(
        `
          DELETE FROM document_pending_attachment_rewraps
          WHERE local_id = :localId
        `,
        {
          ":localId": localId,
        },
      );
    });
  },
  async deletePendingAttachmentReplacement(execSql, localId, slotId) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await lockedExecSql(
        `
          DELETE FROM document_pending_attachment_replacements
          WHERE local_id = :localId AND slot_id = :slotId
        `,
        {
          ":localId": localId,
          ":slotId": slotId,
        },
      );
    });
  },
  async deletePendingAttachmentReplacements(execSql, localId) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await lockedExecSql(
        `
          DELETE FROM document_pending_attachment_replacements
          WHERE local_id = :localId
        `,
        {
          ":localId": localId,
        },
      );
    });
  },
};

export const sqlDocumentsPersistence: DocumentsPersistence =
  sqlStoredDocumentsPersistence;
