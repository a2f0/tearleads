import { and, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import type {
  DiscoveredDocumentInput,
  DocumentSummary,
} from "../../documentSummary";
import { DEFAULT_DOCUMENT_ACCESS_EPOCH } from "../../documents/documentConstants";
import {
  deleteDocumentPendingUpdate,
  deleteDocumentPendingUpdates,
  deleteDocumentRecord,
  enqueueDocumentPendingUpdate,
  ensureDocumentTables,
  findLocalIdByDocumentId,
  listDocumentPendingUpdates,
  loadDocumentRecord,
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
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";
import {
  mapLocalAttachmentRecord,
  mapPendingAttachmentRecord,
} from "./internal/attachmentRows";
import { DOCUMENTS_APP_KIND } from "./internal/constants";
import { applyContainerDocumentTombstonesWithExec } from "./internal/containerDocumentTombstones";
import {
  deriveDocumentTitle,
  documentSummaryJoin,
  documentSummarySelection,
  getProjectionContainerId,
  getProjectionDocumentKind,
  getProjectionText,
  getProjectionTitle,
  getProjectionUpdatedAt,
  mapDocumentSummary,
} from "./internal/documentProjectionRows";
import {
  getDocumentScope,
  resolveDocumentSaveTimestamp,
  saveDocumentRows,
} from "./internal/documentRows";
import {
  resolvePersistedAccessStateHash,
  resolvePersistedDocumentRuntimeState,
} from "./internal/documentRuntimeState";
import type {
  ContainerDocumentTombstoneInput,
  DocumentsPersistence,
  RelinkPersistedDocumentInput,
  StoredDocumentRecord,
} from "./types";

export { DOCUMENTS_APP_KIND } from "./internal/constants";
export type {
  ContainerDocumentTombstoneInput,
  DocumentsPersistence,
  LocalAttachmentRecord,
  PendingAttachmentRecord,
  PendingUpdateInsert,
  PendingUpdateRecord,
  RelinkPersistedDocumentInput,
  StoredDocumentRecord,
} from "./types";

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
    documentKind: existingDocument?.documentKind ?? "note",
    text: existingDocument?.text ?? "",
    title: existingDocument?.title ?? deriveDocumentTitle(""),
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
    documentKind: nextDocument.documentKind ?? "note",
    documentId: nextDocument.documentId,
    title: nextDocument.title ?? deriveDocumentTitle(nextDocument.text),
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

  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const updatedAtRows = await db
    .select({ updatedAt: documentProjection.updatedAt })
    .from(documentProjection)
    .where(eq(documentProjection.localId, input.localId))
    .limit(1);

  return {
    accessStateHash: nextDocument.accessStateHash ?? null,
    id: nextDocument.id,
    containerId: nextDocument.containerId,
    documentKind: nextDocument.documentKind ?? "note",
    documentId: nextDocument.documentId,
    title: nextDocument.title ?? deriveDocumentTitle(nextDocument.text),
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

  const { db } = getClientSQLitePersistenceRuntime(execSql);
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
  const { db } = getClientSQLitePersistenceRuntime(execSql);
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
    const { db } = getClientSQLitePersistenceRuntime(execSql);
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
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const [documentRecord, projectionRows] = await Promise.all([
      loadDocumentRecord(execSql, getDocumentScope(localId)),
      db
        .select({
          documentKind: documentProjection.documentKind,
          text: documentProjection.text,
          title: documentProjection.title,
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
      documentKind: getProjectionDocumentKind(projectionRows[0]),
      text: getProjectionText(projectionRows[0]),
      title: getProjectionTitle(projectionRows[0]),
    };
  },
  async saveDocument(execSql, document, options) {
    return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
      getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) => {
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
        },
      ),
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
      getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) => {
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
        },
      ),
    );
  },
  async deleteDocument(execSql, localId) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const existingDocument = await sqlStoredDocumentsPersistence.loadDocument(
        lockedExecSql,
        localId,
      );

      await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) => {
          await tx
            .delete(documentProjection)
            .where(eq(documentProjection.localId, localId))
            .run();
          await tx
            .delete(documentPendingAttachments)
            .where(eq(documentPendingAttachments.localId, localId))
            .run();
          await tx
            .delete(documentAttachmentBlobProjection)
            .where(eq(documentAttachmentBlobProjection.localId, localId))
            .run();
          if (existingDocument?.documentId) {
            await tx
              .delete(documentContainerProjection)
              .where(
                eq(
                  documentContainerProjection.documentId,
                  existingDocument.documentId,
                ),
              )
              .run();
          }
          await deleteDocumentPendingUpdates(
            lockedExecSql,
            getDocumentScope(localId),
          );
          await deleteDocumentRecord(lockedExecSql, getDocumentScope(localId));
        },
      );
    });
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
    const { db } = getClientSQLitePersistenceRuntime(execSql);
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

    return rows.map(mapPendingAttachmentRecord);
  },
  async listLocalAttachments(execSql, localId) {
    const { db } = getClientSQLitePersistenceRuntime(execSql);
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

    return rows.map(mapLocalAttachmentRecord);
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

    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
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
  async deleteLocalAttachment(execSql, localId, slotId, storageKey) {
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      await db
        .delete(documentAttachmentBlobProjection)
        .where(
          and(
            eq(documentAttachmentBlobProjection.localId, localId),
            eq(documentAttachmentBlobProjection.slotId, slotId),
            eq(documentAttachmentBlobProjection.storageKey, storageKey),
          ),
        )
        .run();
    });
  },
  async savePendingAttachment(execSql, attachment) {
    const createdAt = new Date().toISOString();

    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
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
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
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
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      await db
        .delete(documentPendingAttachments)
        .where(eq(documentPendingAttachments.localId, localId))
        .run();
    });
  },
};

export const sqlDocumentsPersistence: DocumentsPersistence =
  sqlStoredDocumentsPersistence;
