import { and, desc, eq, inArray, notInArray, or, type SQL } from "drizzle-orm";
import {
  DEFAULT_DOCUMENT_ACCESS_EPOCH,
  DEFAULT_DOCUMENT_KIND,
} from "../../documents/documentConstants";
import {
  type DiscoveredDocumentInput,
  type DocumentSummary,
  HIDDEN_DOCUMENT_SUMMARY_KINDS,
} from "../../documents/documentSummary";
import { findLocalIdByDocumentId } from "../../sqlite/documentPersistence";
import {
  documentPendingUpdates,
  documentProjection,
  documents,
} from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, runSerializedSqlMutation } from "../../sqlite/sqlSchema";
import { DOCUMENTS_APP_KIND } from "./internal/constants";
import { applyContainerDocumentTombstonesWithExec } from "./internal/containerDocumentTombstones";
import { createStoredDocumentWithHistoryCheckpoint } from "./internal/createDocumentWithHistoryCheckpoint";
import { discardStoredDocumentToShell } from "./internal/discardDocument";
import {
  deleteStoredDocument,
  deleteStoredDocumentIfMatches,
  deleteStoredDocumentSideRowsIfAbsent,
} from "./internal/documentDeletionPersistence";
import { loadStoredDocumentWithHistoryRestoreState } from "./internal/documentHistoryStatePersistence";
import {
  commitStoredDocumentMutation,
  settleStoredDocumentPendingUpdates,
} from "./internal/documentMutationPersistence";
import {
  documentSummaryJoin,
  documentSummarySelection,
  getProjectionUpdatedAt,
  mapDocumentSummary,
  toDocumentSummary,
} from "./internal/documentProjectionRows";
import { invalidateStoredDocumentPullContinuation } from "./internal/documentPullContinuationPersistence";
import {
  resolveDocumentSaveTimestamp,
  saveDocumentRows,
} from "./internal/documentRows";
import {
  resolvePersistedAccessStateHash,
  resolvePersistedDocumentRuntimeState,
} from "./internal/documentRuntimeState";
import { loadStoredDocumentStoreState } from "./internal/documentStoreStatePersistence";
import { listDocumentSummaries } from "./internal/documentSummaryQueries";
import { ensureDocumentsSchema } from "./internal/ensureDocumentsSchema";
import { mapPendingCreateLocalIds } from "./internal/pendingCreateAdoption";
import { documentRowQueryPersistence } from "./internal/rowQueryPersistence";
import { documentSyncQueuePersistence } from "./internal/syncQueuePersistence";
import type {
  ContainerDocumentTombstoneInput,
  DiscardDocumentToShellResult,
  DocumentsPersistence,
  RelinkPersistedDocumentInput,
  StoredDocumentRecord,
} from "./types";

export { DOCUMENTS_APP_KIND } from "./internal/constants";
export type {
  AttachmentRemovalRows,
  AttachmentStagingRows,
  ContainerDocumentTombstoneInput,
  DiscardDocumentToShellResult,
  DocumentsPersistence,
  LocalAttachmentRecord,
  PendingAttachmentRecord,
  PendingAttachmentUploadIdentity,
  PendingUpdateInsert,
  PendingUpdateRecord,
  RelinkPersistedDocumentInput,
  StoredDocumentRecord,
} from "./types";

const DISCOVERED_DOCUMENT_PLACEHOLDER_TITLE = "Syncing document...";

async function upsertDiscoveredDocumentWithExec(
  execSql: ExecSql,
  input: DiscoveredDocumentInput,
  pendingCreates: ReadonlyMap<string, string>,
): Promise<DocumentSummary> {
  const existingLocalId = await findLocalIdByDocumentId(
    execSql,
    DOCUMENTS_APP_KIND,
    input.documentId,
  );
  const localId =
    existingLocalId ?? pendingCreates.get(input.documentId) ?? input.documentId;
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
    documentKind: existingDocument?.documentKind ?? DEFAULT_DOCUMENT_KIND,
    text: existingDocument?.text ?? "",
    title: existingDocument?.title ?? DISCOVERED_DOCUMENT_PLACEHOLDER_TITLE,
    snapshotEndVersion: existingDocument?.snapshotEndVersion ?? "",
    accessEpoch: nextAccessEpoch,
    accessStateHash: resolvePersistedAccessStateHash(existingDocument, {
      accessEpoch: nextAccessEpoch,
      accessStateHash: input.accessStateHash,
      documentId: input.documentId,
    }),
    effectiveAccessLevel:
      input.effectiveAccessLevel ??
      existingDocument?.effectiveAccessLevel ??
      null,
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

  return toDocumentSummary(nextDocument, updatedAt);
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

  return toDocumentSummary(
    nextDocument,
    getProjectionUpdatedAt(updatedAtRows[0]),
  );
}

export async function upsertDiscoveredDocuments(
  execSql: ExecSql,
  inputs: ReadonlyArray<DiscoveredDocumentInput>,
): Promise<DocumentSummary[]> {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await sqlDocumentsPersistence.ensureSchema(lockedExecSql);
    return getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
      async () => {
        const pendingCreates = await mapPendingCreateLocalIds(lockedExecSql);
        const nextSummaries: DocumentSummary[] = [];

        for (const input of inputs) {
          nextSummaries.push(
            await upsertDiscoveredDocumentWithExec(
              lockedExecSql,
              input,
              pendingCreates,
            ),
          );
        }

        return nextSummaries;
      },
      { behavior: "immediate" },
    );
  });
}

export async function applyContainerDocumentTombstones(
  execSql: ExecSql,
  tombstones: ReadonlyArray<ContainerDocumentTombstoneInput>,
): Promise<DocumentSummary[]> {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await sqlDocumentsPersistence.ensureSchema(lockedExecSql);
    return applyContainerDocumentTombstonesWithExec(lockedExecSql, tombstones);
  });
}

export async function listDocumentsByContainerIdsOrDocumentIds(
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
    .where(
      and(
        whereCondition,
        notInArray(documentProjection.documentKind, [
          ...HIDDEN_DOCUMENT_SUMMARY_KINDS,
        ]),
      ),
    )
    .orderBy(
      desc(documentProjection.updatedAt),
      desc(documentProjection.localId),
    );

  return rows.map(mapDocumentSummary);
}

export const sqlDocumentsPersistence: DocumentsPersistence = {
  ...documentRowQueryPersistence,
  ...documentSyncQueuePersistence,
  supportsAtomicRecoveryHistoryPruning: true,
  createDocumentWithHistoryCheckpoint:
    createStoredDocumentWithHistoryCheckpoint,
  commitDocumentMutation: (execSql, input, saveClientProjection) =>
    commitStoredDocumentMutation(
      execSql,
      input,
      saveClientProjection,
      sqlDocumentsPersistence.loadDocument,
    ),
  settleAcceptedPendingUpdates: (execSql, input) =>
    settleStoredDocumentPendingUpdates(
      execSql,
      input,
      sqlDocumentsPersistence.loadDocument,
    ),
  ensureSchema: ensureDocumentsSchema,
  listDocumentSummaries,
  listDocumentsByContainerIdsOrDocumentIds,
  invalidatePullContinuation: (execSql, input) =>
    invalidateStoredDocumentPullContinuation(
      execSql,
      input,
      sqlDocumentsPersistence.loadDocument,
      sqlDocumentsPersistence.loadHistoryRestoreState,
    ),
  loadDocumentWithHistoryRestoreState: (execSql, localId) =>
    loadStoredDocumentWithHistoryRestoreState(
      execSql,
      localId,
      sqlDocumentsPersistence,
    ),
  loadDocumentStoreState: (execSql, localId) =>
    loadStoredDocumentStoreState(execSql, localId, sqlDocumentsPersistence),
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
          const saved = await saveDocumentRows({
            document,
            tx,
            updatedAt,
          });
          if (!saved) return updatedAt;
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
          return updatedAt;
        },
      ),
    );
  },
  deleteDocument: deleteStoredDocument,
  deleteDocumentIfMatches: deleteStoredDocumentIfMatches,
  deleteDocumentSideRowsIfAbsent: deleteStoredDocumentSideRowsIfAbsent,
  async discardDocumentToShell(
    execSql,
    localId,
    expectedDocumentId,
    documentProjectors,
  ): Promise<DiscardDocumentToShellResult> {
    return discardStoredDocumentToShell({
      documentProjectors,
      execSql,
      expectedDocumentId,
      localId,
      persistence: sqlDocumentsPersistence,
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
      await sqlDocumentsPersistence.ensureSchema(lockedExecSql);
      return getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        () => relinkPersistedDocumentWithExec(lockedExecSql, input),
        { behavior: "immediate" },
      );
    });
  },
};
