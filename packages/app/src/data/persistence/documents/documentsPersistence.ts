import { and, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import { DEFAULT_DOCUMENT_ACCESS_EPOCH } from "../../documents/documentConstants";
import {
  deriveStoredDocumentKind,
  deriveStoredDocumentTitle,
  type StoredDocumentKind,
} from "../../documents/documentKinds";
import { getAppDatabaseRuntime } from "../../sqlite/appDatabaseRuntime";
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
} from "../../sqlite/documentPersistence";
import {
  documentAttachmentBlobProjection,
  documentPendingAttachments,
  documentProjection,
  documentProjectionTables,
  documents,
} from "../../sqlite/schema";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";

export type { PendingUpdateRecord } from "../../sqlite/documentPersistence";

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
  deletePendingUpdate: (execSql: ExecSql, id: string) => Promise<void>;
  deletePendingUpdates: (execSql: ExecSql, localId: string) => Promise<void>;
  deletePendingAttachment: (
    execSql: ExecSql,
    localId: string,
    slotId: string,
    storageKey: string,
  ) => Promise<void>;
  deletePendingAttachments: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<void>;
}

export const DOCUMENTS_APP_KIND = "documents";

function getDocumentScope(localId: string): DocumentScope {
  return {
    appKind: DOCUMENTS_APP_KIND,
    localId,
  };
}

interface SelectedDocumentProjection {
  localId: string | null;
  documentId: string | null;
  containerId: string | null;
  text: string;
  updatedAt: string;
  accessStateHash: string | null;
}

interface SelectedDocumentProjectionDetail {
  text: string;
  containerId: string | null;
}

interface SelectedDocumentProjectionTimestamp {
  text?: string;
  updatedAt: string;
}

interface SelectedPendingAttachment {
  localId: string;
  slotId: string;
  name: string;
  mimeType: string | null;
  storageKey: string;
  byteLength: number;
}

interface SelectedLocalAttachment {
  localId: string;
  slotId: string;
  blobId: string | null;
  storageKey: string;
  mimeType: string | null;
  byteLength: number;
}

function mapDocumentSummary(row: SelectedDocumentProjection): DocumentSummary {
  return {
    accessStateHash: row.accessStateHash,
    id: String(row.localId ?? ""),
    containerId: row.containerId,
    documentKind: derivePersistedDocumentKind(row.text),
    documentId: row.documentId,
    title: derivePersistedDocumentTitle(row.text),
    updatedAt: row.updatedAt,
  };
}

function getProjectionText(
  row:
    | SelectedDocumentProjectionDetail
    | SelectedDocumentProjectionTimestamp
    | undefined,
): string {
  return row?.text ?? "";
}

function getProjectionContainerId(
  row: SelectedDocumentProjectionDetail | undefined,
): string | null {
  return row?.containerId ?? null;
}

function getProjectionUpdatedAt(
  row: SelectedDocumentProjectionTimestamp | undefined,
): string {
  return row?.updatedAt ?? "";
}

const documentSummarySelection = {
  localId: documentProjection.localId,
  documentId: documentProjection.documentId,
  containerId: documentProjection.containerId,
  text: documentProjection.text,
  updatedAt: documentProjection.updatedAt,
  accessStateHash: documents.accessStateHash,
};

const documentSummaryJoin = and(
  eq(documents.appKind, DOCUMENTS_APP_KIND),
  eq(documents.localId, documentProjection.localId),
);

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

function didPersistedDocumentSecurityContextChange(
  existingDocument: StoredDocumentRecord | null | undefined,
  input: {
    accessEpoch: number;
    documentId: string;
  },
): boolean {
  return (
    existingDocument?.documentId !== input.documentId ||
    (existingDocument?.accessEpoch ?? DEFAULT_DOCUMENT_ACCESS_EPOCH) !==
      input.accessEpoch
  );
}

function resolvePersistedDocumentRuntimeState(
  existingDocument: StoredDocumentRecord | null | undefined,
  input: {
    accessEpoch: number;
    documentId: string;
  },
): Pick<
  StoredDocumentRecord,
  | "lastCommitLsn"
  | "contentKeyBundle"
  | "documentKekTargets"
  | "documentManifestBundle"
> {
  const documentIdChanged = existingDocument?.documentId !== input.documentId;
  const securityContextChanged = didPersistedDocumentSecurityContextChange(
    existingDocument,
    input,
  );

  return {
    lastCommitLsn: documentIdChanged
      ? null
      : (existingDocument?.lastCommitLsn ?? null),
    contentKeyBundle: securityContextChanged
      ? null
      : (existingDocument?.contentKeyBundle ?? null),
    documentKekTargets: securityContextChanged
      ? null
      : (existingDocument?.documentKekTargets ?? null),
    documentManifestBundle: securityContextChanged
      ? null
      : (existingDocument?.documentManifestBundle ?? null),
  };
}

function resolvePersistedAccessStateHash(
  existingDocument: StoredDocumentRecord | null | undefined,
  input: {
    accessEpoch: number;
    accessStateHash?: string | null | undefined;
    documentId: string;
  },
): string | null {
  if (input.accessStateHash !== undefined) {
    return input.accessStateHash;
  }

  const securityContextChanged = didPersistedDocumentSecurityContextChange(
    existingDocument,
    input,
  );
  return securityContextChanged
    ? null
    : (existingDocument?.accessStateHash ?? null);
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
  const nextAccessEpoch = Math.max(
    existingDocument?.accessEpoch ?? DEFAULT_DOCUMENT_ACCESS_EPOCH,
    input.accessEpoch,
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
    text: existingDocument?.text ?? "",
    loroSnapshot: existingDocument?.loroSnapshot ?? "",
    accessEpoch: nextAccessEpoch,
    accessStateHash: resolvePersistedAccessStateHash(existingDocument, {
      accessEpoch: nextAccessEpoch,
      accessStateHash: input.accessStateHash,
      documentId: input.documentId,
    }),
    ...resolvePersistedDocumentRuntimeState(existingDocument, {
      accessEpoch: nextAccessEpoch,
      documentId: input.documentId,
    }),
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
    accessStateHash: resolvePersistedAccessStateHash(existingDocument, {
      accessEpoch: nextAccessEpoch,
      accessStateHash: input.accessStateHash,
      documentId: input.documentId,
    }),
    containerId: input.containerId,
    documentId: input.documentId,
    ...resolvePersistedDocumentRuntimeState(existingDocument, {
      accessEpoch: nextAccessEpoch,
      documentId: input.documentId,
    }),
  };

  await sqlDocumentsPersistence.saveDocument(execSql, nextDocument);

  const { db } = getAppDatabaseRuntime(execSql);
  const updatedAtRows = await db
    .select({ updatedAt: documentProjection.updatedAt })
    .from(documentProjection)
    .where(eq(documentProjection.localId, input.localId))
    .limit(1);

  return {
    accessStateHash: nextDocument.accessStateHash ?? null,
    id: nextDocument.id,
    containerId: nextDocument.containerId,
    documentKind: derivePersistedDocumentKind(nextDocument.text),
    documentId: nextDocument.documentId,
    title: derivePersistedDocumentTitle(nextDocument.text),
    updatedAt: getProjectionUpdatedAt(updatedAtRows[0]),
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

  const { db } = getAppDatabaseRuntime(execSql);
  const rows = await db
    .select(documentSummarySelection)
    .from(documentProjection)
    .leftJoin(documents, documentSummaryJoin)
    .where(inArray(documentProjection.containerId, uniqueContainerIds))
    .orderBy(
      desc(documentProjection.updatedAt),
      desc(documentProjection.localId),
    );

  return rows.map(mapDocumentSummary);
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

  const filters: SQL[] = [];
  if (uniqueContainerIds.length > 0) {
    filters.push(inArray(documentProjection.containerId, uniqueContainerIds));
  }

  if (uniqueDocumentIds.length > 0) {
    filters.push(inArray(documentProjection.documentId, uniqueDocumentIds));
  }

  const whereCondition = filters.length === 1 ? filters[0] : or(...filters);
  const { db } = getAppDatabaseRuntime(execSql);
  const rows = await db
    .select(documentSummarySelection)
    .from(documentProjection)
    .leftJoin(documents, documentSummaryJoin)
    .where(whereCondition)
    .orderBy(
      desc(documentProjection.updatedAt),
      desc(documentProjection.localId),
    );

  return rows.map(mapDocumentSummary);
}

const sqlStoredDocumentsPersistence: DocumentsPersistence = {
  async ensureSchema(execSql) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await ensureDocumentTables(lockedExecSql);
      await ensureSqlTables(lockedExecSql, documentProjectionTables);
    });
  },
  async listDocuments(execSql) {
    const { db } = getAppDatabaseRuntime(execSql);
    const rows = await db
      .select(documentSummarySelection)
      .from(documentProjection)
      .leftJoin(documents, documentSummaryJoin)
      .orderBy(
        desc(documentProjection.updatedAt),
        desc(documentProjection.localId),
      );

    return rows.map(mapDocumentSummary);
  },
  listDocumentsByContainerIdsOrDocumentIds,
  async loadDocument(execSql, localId) {
    const { db } = getAppDatabaseRuntime(execSql);
    const [documentRecord, projectionRows] = await Promise.all([
      loadDocumentRecord(execSql, getDocumentScope(localId)),
      db
        .select({
          text: documentProjection.text,
          containerId: documentProjection.containerId,
        })
        .from(documentProjection)
        .where(eq(documentProjection.localId, localId))
        .limit(1),
    ]);

    if (!documentRecord) {
      return null;
    }

    return {
      ...documentRecord,
      containerId: getProjectionContainerId(projectionRows[0]),
      text: getProjectionText(projectionRows[0]),
    };
  },
  async saveDocument(execSql, document, options) {
    return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
      getAppDatabaseRuntime(lockedExecSql).transaction(async (tx) => {
        const [existingRecord, projectionRows] = await Promise.all([
          loadDocumentRecord(lockedExecSql, getDocumentScope(document.id)),
          tx
            .select({
              text: documentProjection.text,
              updatedAt: documentProjection.updatedAt,
            })
            .from(documentProjection)
            .where(eq(documentProjection.localId, document.id))
            .limit(1),
        ]);
        const existingProjection = projectionRows[0];
        const updatedAt =
          options?.updatedAt ??
          (didStoredDocumentContentChange(
            existingRecord
              ? {
                  loroSnapshot: existingRecord.loroSnapshot,
                  text: getProjectionText(existingProjection),
                }
              : null,
            document,
          )
            ? new Date().toISOString()
            : getProjectionUpdatedAt(existingProjection) ||
              new Date().toISOString());

        await saveDocumentRecord(
          lockedExecSql,
          getDocumentScope(document.id),
          document,
          updatedAt,
        );
        const projectionRow = {
          localId: document.id,
          documentId: document.documentId,
          containerId: document.containerId,
          text: document.text,
          updatedAt,
        };
        await tx
          .insert(documentProjection)
          .values(projectionRow)
          .onConflictDoUpdate({
            target: documentProjection.localId,
            set: projectionRow,
          })
          .run();

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
    const { db } = getAppDatabaseRuntime(execSql);
    const rows = await db
      .select({
        localId: documentPendingAttachments.localId,
        slotId: documentPendingAttachments.slotId,
        name: documentPendingAttachments.name,
        mimeType: documentPendingAttachments.mimeType,
        storageKey: documentPendingAttachments.storageKey,
        byteLength: documentPendingAttachments.byteLength,
      })
      .from(documentPendingAttachments)
      .where(eq(documentPendingAttachments.localId, localId))
      .orderBy(
        documentPendingAttachments.createdAt,
        documentPendingAttachments.slotId,
      );

    return rows.map((row: SelectedPendingAttachment) => ({
      byteLength: row.byteLength,
      localId: row.localId,
      mimeType: row.mimeType,
      name: row.name,
      slotId: row.slotId,
      storageKey: row.storageKey,
    }));
  },
  async listLocalAttachments(execSql, localId) {
    const { db } = getAppDatabaseRuntime(execSql);
    const rows = await db
      .select({
        localId: documentAttachmentBlobProjection.localId,
        slotId: documentAttachmentBlobProjection.slotId,
        blobId: documentAttachmentBlobProjection.blobId,
        storageKey: documentAttachmentBlobProjection.storageKey,
        mimeType: documentAttachmentBlobProjection.mimeType,
        byteLength: documentAttachmentBlobProjection.byteLength,
      })
      .from(documentAttachmentBlobProjection)
      .where(eq(documentAttachmentBlobProjection.localId, localId));

    return rows.map((row: SelectedLocalAttachment) => ({
      blobId: row.blobId,
      byteLength: row.byteLength,
      localId: row.localId,
      mimeType: row.mimeType,
      slotId: row.slotId,
      storageKey: row.storageKey,
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

    await getAppDatabaseRuntime(execSql).runMutation(async (db) => {
      const attachmentRow = {
        localId: attachment.localId,
        slotId: attachment.slotId,
        blobId: attachment.blobId,
        storageKey: attachment.storageKey,
        mimeType: attachment.mimeType,
        byteLength: attachment.byteLength,
        updatedAt,
      };
      await db
        .insert(documentAttachmentBlobProjection)
        .values(attachmentRow)
        .onConflictDoUpdate({
          target: [
            documentAttachmentBlobProjection.localId,
            documentAttachmentBlobProjection.slotId,
          ],
          set: attachmentRow,
        })
        .run();
    });
  },
  async savePendingAttachment(execSql, attachment) {
    const createdAt = new Date().toISOString();

    await getAppDatabaseRuntime(execSql).runMutation(async (db) => {
      const attachmentRow = {
        localId: attachment.localId,
        slotId: attachment.slotId,
        name: attachment.name,
        mimeType: attachment.mimeType,
        storageKey: attachment.storageKey,
        byteLength: attachment.byteLength,
        createdAt,
      };
      await db
        .insert(documentPendingAttachments)
        .values(attachmentRow)
        .onConflictDoUpdate({
          target: [
            documentPendingAttachments.localId,
            documentPendingAttachments.slotId,
          ],
          set: {
            name: attachmentRow.name,
            mimeType: attachmentRow.mimeType,
            storageKey: attachmentRow.storageKey,
            byteLength: attachmentRow.byteLength,
          },
        })
        .run();
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
  async deletePendingAttachment(execSql, localId, slotId, storageKey) {
    await getAppDatabaseRuntime(execSql).runMutation(async (db) => {
      await db
        .delete(documentPendingAttachments)
        .where(
          and(
            eq(documentPendingAttachments.localId, localId),
            eq(documentPendingAttachments.slotId, slotId),
            eq(documentPendingAttachments.storageKey, storageKey),
          ),
        )
        .run();
    });
  },
  async deletePendingAttachments(execSql, localId) {
    await getAppDatabaseRuntime(execSql).runMutation(async (db) => {
      await db
        .delete(documentPendingAttachments)
        .where(eq(documentPendingAttachments.localId, localId))
        .run();
    });
  },
};

export const sqlDocumentsPersistence: DocumentsPersistence =
  sqlStoredDocumentsPersistence;
