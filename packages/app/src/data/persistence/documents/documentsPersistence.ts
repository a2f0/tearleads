import { and, asc, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import { DEFAULT_DOCUMENT_ACCESS_EPOCH } from "../../documents/documentConstants";
import {
  deriveStoredDocumentKind,
  deriveStoredDocumentTitle,
  type StoredDocumentKind,
} from "../../documents/documentKinds";
import type {
  DiscoveredDocumentInput,
  DocumentSummary,
} from "../../documents/shared/documentSummary";
import {
  type AppSQLiteTransaction,
  getAppDatabaseRuntime,
} from "../../sqlite/appDatabaseRuntime";
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
  mapSelectedDocumentRecord,
  type PendingUpdateFields,
  type PendingUpdateRecord,
} from "../../sqlite/documentPersistence";
import {
  documentAttachmentBlobProjection,
  documentContainerProjection,
  documentContainerProjectionTables,
  documentPendingAttachments,
  documentPendingUpdates,
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

export interface RelinkPersistedDocumentInput {
  accessEpoch: number;
  accessStateHash?: string | null;
  containerId: string;
  documentId: string;
  localId: string;
}

export interface ContainerDocumentTombstoneInput {
  containerId: string;
  documentId: string;
  updatedAt: string;
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
  saveDocumentAndDeletePendingUpdates: (
    execSql: ExecSql,
    document: StoredDocumentRecord,
    pendingUpdateIds: readonly string[],
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

async function loadDocumentRecordInTransaction(input: {
  localId: string;
  tx: AppSQLiteTransaction;
}): Promise<BaseDocumentRecord | null> {
  const { localId, tx } = input;
  const rows = await tx
    .select({
      id: documents.localId,
      documentId: documents.documentId,
      loroSnapshot: documents.loroSnapshot,
      accessEpoch: documents.accessEpoch,
      accessStateHash: documents.accessStateHash,
      lastCommitLsn: documents.lastCommitLsn,
      documentManifestBundle: documents.documentManifestBundle,
      contentKeyBundle: documents.contentKeyBundle,
      documentKekTargets: documents.documentKekTargets,
    })
    .from(documents)
    .where(
      and(
        eq(documents.appKind, DOCUMENTS_APP_KIND),
        eq(documents.localId, localId),
      ),
    )
    .limit(1);

  return rows[0] ? mapSelectedDocumentRecord(rows[0]) : null;
}

function toDocumentRecordRow(input: {
  document: StoredDocumentRecord;
  updatedAt: string;
}) {
  const { document, updatedAt } = input;
  return {
    appKind: DOCUMENTS_APP_KIND,
    localId: document.id,
    documentId: document.documentId,
    loroSnapshot: document.loroSnapshot,
    accessEpoch: document.accessEpoch,
    accessStateHash: document.accessStateHash ?? null,
    lastCommitLsn: document.lastCommitLsn ?? null,
    documentManifestBundle: document.documentManifestBundle ?? null,
    contentKeyBundle: document.contentKeyBundle ?? null,
    documentKekTargets: document.documentKekTargets ?? null,
    updatedAt,
  };
}

async function saveDocumentRows(input: {
  document: StoredDocumentRecord;
  tx: AppSQLiteTransaction;
  updatedAt: string;
}) {
  const { document, tx, updatedAt } = input;
  const documentRow = toDocumentRecordRow({ document, updatedAt });
  await tx
    .insert(documents)
    .values(documentRow)
    .onConflictDoUpdate({
      target: [documents.appKind, documents.localId],
      set: documentRow,
    })
    .run();

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
}

async function resolveDocumentSaveTimestamp(input: {
  document: StoredDocumentRecord;
  options?: { updatedAt?: string } | undefined;
  tx: AppSQLiteTransaction;
}): Promise<string> {
  const { document, options, tx } = input;
  if (options?.updatedAt) {
    return options.updatedAt;
  }

  const [existingRecord, projectionRows] = await Promise.all([
    loadDocumentRecordInTransaction({
      localId: document.id,
      tx,
    }),
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
  return didStoredDocumentContentChange(
    existingRecord
      ? {
          loroSnapshot: existingRecord.loroSnapshot,
          text: getProjectionText(existingProjection),
        }
      : null,
    document,
  )
    ? new Date().toISOString()
    : getProjectionUpdatedAt(existingProjection) || new Date().toISOString();
}

function getLatestTimestamp(
  left: string | undefined,
  right: string | undefined,
): string {
  if (!left) {
    return right ?? new Date().toISOString();
  }

  if (!right) {
    return left;
  }

  return left.localeCompare(right) >= 0 ? left : right;
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

function dedupeContainerDocumentTombstones(
  tombstones: ReadonlyArray<ContainerDocumentTombstoneInput>,
): ContainerDocumentTombstoneInput[] {
  return Array.from(
    new Map(
      tombstones.map((tombstone) => [
        `${tombstone.documentId}\u0000${tombstone.containerId}`,
        tombstone,
      ]),
    ).values(),
  );
}

function buildContainerDocumentTombstoneState(
  uniqueTombstones: ReadonlyArray<ContainerDocumentTombstoneInput>,
): {
  removedContainerIdsByDocumentId: Map<string, Set<string>>;
  tombstoneUpdatedAtByDocumentId: Map<string, string>;
} {
  const removedContainerIdsByDocumentId = new Map<string, Set<string>>();
  const tombstoneUpdatedAtByDocumentId = new Map<string, string>();

  for (const tombstone of uniqueTombstones) {
    const removedContainerIds =
      removedContainerIdsByDocumentId.get(tombstone.documentId) ?? new Set();
    removedContainerIds.add(tombstone.containerId);
    removedContainerIdsByDocumentId.set(
      tombstone.documentId,
      removedContainerIds,
    );
    tombstoneUpdatedAtByDocumentId.set(
      tombstone.documentId,
      getLatestTimestamp(
        tombstoneUpdatedAtByDocumentId.get(tombstone.documentId),
        tombstone.updatedAt,
      ),
    );
  }

  return { removedContainerIdsByDocumentId, tombstoneUpdatedAtByDocumentId };
}

async function deleteContainerDocumentTombstoneRows(
  tx: AppSQLiteTransaction,
  uniqueTombstones: ReadonlyArray<ContainerDocumentTombstoneInput>,
): Promise<void> {
  for (const tombstone of uniqueTombstones) {
    await tx
      .delete(documentContainerProjection)
      .where(
        and(
          eq(documentContainerProjection.documentId, tombstone.documentId),
          eq(documentContainerProjection.containerId, tombstone.containerId),
        ),
      )
      .run();
  }
}

async function updateSelectedContainerForDocumentTombstones(input: {
  documentId: string;
  removedContainerIds: ReadonlySet<string>;
  tombstoneUpdatedAt: string | undefined;
  tx: AppSQLiteTransaction;
}): Promise<string | null> {
  const { documentId, removedContainerIds, tombstoneUpdatedAt, tx } = input;
  const documentRows = await tx
    .select({ localId: documents.localId })
    .from(documents)
    .where(
      and(
        eq(documents.appKind, DOCUMENTS_APP_KIND),
        eq(documents.documentId, documentId),
      ),
    )
    .limit(1);
  const localId = documentRows[0]?.localId;
  if (!localId) {
    return null;
  }

  const projectionRows = await tx
    .select({
      containerId: documentProjection.containerId,
      updatedAt: documentProjection.updatedAt,
    })
    .from(documentProjection)
    .where(eq(documentProjection.localId, localId))
    .limit(1);
  const selectedContainerId = projectionRows[0]?.containerId;
  if (!selectedContainerId || !removedContainerIds.has(selectedContainerId)) {
    return null;
  }

  const remainingLinkRows = await tx
    .select({ containerId: documentContainerProjection.containerId })
    .from(documentContainerProjection)
    .where(eq(documentContainerProjection.documentId, documentId))
    .orderBy(asc(documentContainerProjection.containerId));
  const nextContainerId = remainingLinkRows[0]?.containerId ?? null;

  await tx
    .update(documentProjection)
    .set({
      containerId: nextContainerId,
      updatedAt: getLatestTimestamp(
        projectionRows[0]?.updatedAt,
        tombstoneUpdatedAt,
      ),
    })
    .where(eq(documentProjection.localId, localId))
    .run();

  return localId;
}

async function applyContainerDocumentTombstonesWithExec(
  execSql: ExecSql,
  tombstones: ReadonlyArray<ContainerDocumentTombstoneInput>,
): Promise<DocumentSummary[]> {
  const uniqueTombstones = dedupeContainerDocumentTombstones(tombstones);
  if (uniqueTombstones.length === 0) {
    return [];
  }

  const { removedContainerIdsByDocumentId, tombstoneUpdatedAtByDocumentId } =
    buildContainerDocumentTombstoneState(uniqueTombstones);
  const { db } = getAppDatabaseRuntime(execSql);

  return db.transaction(async (tx) => {
    await deleteContainerDocumentTombstoneRows(tx, uniqueTombstones);

    const changedLocalIds: string[] = [];
    for (const [
      documentId,
      removedContainerIds,
    ] of removedContainerIdsByDocumentId) {
      const changedLocalId = await updateSelectedContainerForDocumentTombstones(
        {
          documentId,
          removedContainerIds,
          tombstoneUpdatedAt: tombstoneUpdatedAtByDocumentId.get(documentId),
          tx,
        },
      );
      if (changedLocalId) {
        changedLocalIds.push(changedLocalId);
      }
    }

    if (changedLocalIds.length === 0) {
      return [];
    }

    const rows = await tx
      .select(documentSummarySelection)
      .from(documentProjection)
      .leftJoin(documents, documentSummaryJoin)
      .where(inArray(documentProjection.localId, changedLocalIds))
      .orderBy(
        desc(documentProjection.updatedAt),
        desc(documentProjection.localId),
      );

    return rows.map(mapDocumentSummary);
  });
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

export async function applyContainerDocumentTombstones(
  execSql: ExecSql,
  tombstones: ReadonlyArray<ContainerDocumentTombstoneInput>,
): Promise<DocumentSummary[]> {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await sqlStoredDocumentsPersistence.ensureSchema(lockedExecSql);
    return applyContainerDocumentTombstonesWithExec(lockedExecSql, tombstones);
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
      await ensureSqlTables(lockedExecSql, documentContainerProjectionTables);
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
        const updatedAt = await resolveDocumentSaveTimestamp({
          document,
          options,
          tx,
        });
        await saveDocumentRows({
          document,
          tx,
          updatedAt,
        });

        return updatedAt;
      }),
    );
  },
  async saveDocumentAndDeletePendingUpdates(
    execSql,
    document,
    pendingUpdateIds,
    options,
  ) {
    const uniquePendingUpdateIds = [...new Set(pendingUpdateIds)];

    return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
      getAppDatabaseRuntime(lockedExecSql).transaction(async (tx) => {
        const updatedAt = await resolveDocumentSaveTimestamp({
          document,
          options,
          tx,
        });
        if (uniquePendingUpdateIds.length > 0) {
          await tx
            .delete(documentPendingUpdates)
            .where(
              and(
                eq(documentPendingUpdates.appKind, DOCUMENTS_APP_KIND),
                eq(documentPendingUpdates.localId, document.id),
                inArray(documentPendingUpdates.id, uniquePendingUpdateIds),
              ),
            )
            .run();
        }
        await saveDocumentRows({
          document,
          tx,
          updatedAt,
        });

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
