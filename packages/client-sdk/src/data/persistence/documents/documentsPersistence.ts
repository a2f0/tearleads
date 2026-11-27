import { and, desc, eq, inArray, notInArray, or, type SQL } from "drizzle-orm";
import {
  type DiscoveredDocumentInput,
  type DocumentSummary,
  HIDDEN_DOCUMENT_SUMMARY_KINDS,
} from "../../documents/documentSummary";
import { documentProjection } from "../../sqlite/schema/documentProjectionSchema";
import { documents } from "../../sqlite/schema/documentRecordSchema";
import { sqliteRowsPerStatement } from "../../sqlite/sqliteBindBudget";
import { registerClientSQLiteCommitGuard } from "../../sqlite/sqliteCommitGuards";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, runSerializedSqlMutation } from "../../sqlite/sqlSchema";
import { settleAttachmentRemovalMarker } from "./internal/attachmentRemovalMarkerPersistence";
import {
  applyContainerDocumentTombstonesWithExec,
  type ContainerDocumentTombstonePlacementRemoval,
} from "./internal/containerDocumentTombstones";
import { createStoredDocumentWithHistoryCheckpoint } from "./internal/createDocumentWithHistoryCheckpoint";
import { discardStoredDocumentToShell } from "./internal/discardDocument";
import { upsertDiscoveredDocumentsInTransaction } from "./internal/discoveredDocumentUpsert";
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
  getDocumentScope,
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
import { saveHydratedAttachment } from "./internal/hydratedAttachmentPersistence";
import {
  acknowledgeDocumentOrphanBlobReclaim,
  deleteOrphanedDocumentSideRows,
  isDocumentBlobStorageKeyReferenced,
  listDocumentOrphanBlobReclaims,
} from "./internal/orphanSideRows";
import { mapPendingCreateLocalIds } from "./internal/pendingCreateAdoption";
import { documentRowQueryPersistence } from "./internal/rowQueryPersistence";
import { documentSyncQueuePersistence } from "./internal/syncQueuePersistence";
import { settleQueuedDocumentUpdatesInTransaction } from "./records/documentPendingUpdatePersistence";
import { installDocumentPeerRebase } from "./records/peerRebaseInstall";
import type {
  ContainerDocumentTombstoneInput,
  DiscardDocumentToShellResult,
  DocumentsPersistence,
  RelinkPersistedDocumentInput,
  StoredDocumentRecord,
} from "./types";

export { DOCUMENTS_APP_KIND } from "../../documents/documentConstants";
export type { DocumentPlacementCleanup } from "./documentDeletionPort";
export type { PendingUpdateRecord, QueuedPendingUpdateRecord } from "./records";
export type {
  AttachmentRemovalMarkerObservation,
  AttachmentRemovalMarkerSettlement,
  AttachmentRemovalRows,
  AttachmentStagingRows,
  ContainerDocumentTombstoneInput,
  DiscardDocumentToShellResult,
  DocumentPeerRebaseInstall,
  DocumentPeerRebaseRecord,
  DocumentsPersistence,
  LocalAttachmentRecord,
  PendingAttachmentRecord,
  PendingAttachmentUploadIdentity,
  PendingUpdateInsert,
  RelinkPersistedDocumentInput,
  SettleAttachmentRemovalMarkerInput,
  StoredDocumentRecord,
} from "./types";

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
  assertCurrent?: () => void,
): Promise<DocumentSummary[]> {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await sqlDocumentsPersistence.ensureSchema(lockedExecSql);
    return getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
      async (tx) => {
        if (assertCurrent)
          registerClientSQLiteCommitGuard(lockedExecSql, assertCurrent);
        const pendingCreates = await mapPendingCreateLocalIds(lockedExecSql);
        return upsertDiscoveredDocumentsInTransaction(
          lockedExecSql,
          inputs,
          pendingCreates,
          tx,
        );
      },
      { behavior: "immediate" },
    );
  });
}

export async function applyContainerDocumentTombstones(
  execSql: ExecSql,
  tombstones: ReadonlyArray<ContainerDocumentTombstoneInput>,
  removePlacementRows: ContainerDocumentTombstonePlacementRemoval,
): Promise<DocumentSummary[]> {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await sqlDocumentsPersistence.ensureSchema(lockedExecSql);
    return applyContainerDocumentTombstonesWithExec(
      lockedExecSql,
      tombstones,
      removePlacementRows,
    );
  });
}

// Reserves fixed binds for `documentSummaryJoin` (`app_kind`) and the hidden
// document-kind exclusion list.
const DOCUMENT_LOOKUP_BATCH_SIZE = sqliteRowsPerStatement(
  1,
  1 + HIDDEN_DOCUMENT_SUMMARY_KINDS.length,
);

function compareStringsDesc(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? 1 : -1;
}

async function queryDocumentSummaries(
  execSql: ExecSql,
  whereCondition: SQL,
): Promise<DocumentSummary[]> {
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

async function collectBatchedDocumentSummaries(
  execSql: ExecSql,
  values: ReadonlyArray<string>,
  buildCondition: (batch: ReadonlyArray<string>) => SQL,
  summariesByLocalId: Map<string, DocumentSummary>,
): Promise<void> {
  for (
    let offset = 0;
    offset < values.length;
    offset += DOCUMENT_LOOKUP_BATCH_SIZE
  ) {
    const batch = await queryDocumentSummaries(
      execSql,
      buildCondition(values.slice(offset, offset + DOCUMENT_LOOKUP_BATCH_SIZE)),
    );
    for (const summary of batch) summariesByLocalId.set(summary.id, summary);
  }
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

  if (
    uniqueContainerIds.length + uniqueDocumentIds.length <=
    DOCUMENT_LOOKUP_BATCH_SIZE
  ) {
    const filters: SQL[] = [];
    if (uniqueContainerIds.length > 0) {
      filters.push(inArray(documentProjection.containerId, uniqueContainerIds));
    }
    if (uniqueDocumentIds.length > 0) {
      filters.push(inArray(documentProjection.documentId, uniqueDocumentIds));
    }
    const whereCondition = filters.length === 1 ? filters[0] : or(...filters);
    if (!whereCondition) return [];
    return queryDocumentSummaries(execSql, whereCondition);
  }

  const summariesByLocalId = new Map<string, DocumentSummary>();
  await collectBatchedDocumentSummaries(
    execSql,
    uniqueContainerIds,
    (batch) => inArray(documentProjection.containerId, batch),
    summariesByLocalId,
  );
  await collectBatchedDocumentSummaries(
    execSql,
    uniqueDocumentIds,
    (batch) => inArray(documentProjection.documentId, batch),
    summariesByLocalId,
  );

  return Array.from(summariesByLocalId.values()).sort(
    (left, right) =>
      compareStringsDesc(left.updatedAt, right.updatedAt) ||
      compareStringsDesc(left.id, right.id),
  );
}

export const sqlDocumentsPersistence: DocumentsPersistence = {
  orphanBlobs: {
    acknowledge: acknowledgeDocumentOrphanBlobReclaim,
    isReferenced: isDocumentBlobStorageKeyReferenced,
    list: listDocumentOrphanBlobReclaims,
    sweep: deleteOrphanedDocumentSideRows,
  },
  ...documentRowQueryPersistence,
  ...documentSyncQueuePersistence,
  supportsAtomicRecoveryHistoryPruning: true,
  installPeerRebase: installDocumentPeerRebase,
  saveHydratedAttachment,
  settleAttachmentRemovalMarker,
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
        { behavior: "immediate" },
      ),
    );
  },
  async saveDocumentAndDeletePendingUpdates(
    execSql,
    document,
    pendingUpdateIds,
    options,
  ) {
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
          await settleQueuedDocumentUpdatesInTransaction(
            tx,
            getDocumentScope(document.id),
            pendingUpdateIds,
          );
          return updatedAt;
        },
        { behavior: "immediate" },
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
