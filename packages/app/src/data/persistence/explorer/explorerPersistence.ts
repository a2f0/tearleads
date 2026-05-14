import { and, asc, eq, inArray } from "drizzle-orm";
import {
  type AppSQLiteTransaction,
  getAppDatabaseRuntime,
} from "../../sqlite/appDatabaseRuntime";
import {
  type DocumentRecord,
  deleteDocumentPendingUpdates,
  enqueueDocumentPendingUpdate,
  ensureDocumentTables,
  listDocumentPendingUpdates,
  loadDocumentRecord,
  type PendingUpdateFields,
  type PendingUpdateRecord,
} from "../../sqlite/documentPersistence";
import {
  containerCreateIntents,
  containerCreateIntentTables,
  documentContainerProjection,
  documentContainerProjectionTables,
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
import {
  type ContainerRecord,
  deleteContainers as deleteContainerRecords,
  ensureContainerTables,
  loadContainers as loadContainerRecords,
  saveContainerRows,
} from "../containers/containerPersistence";
import { sqlContainerSyncWatermarkPersistence } from "../containers/containerSyncWatermarkPersistence";

const CONTAINER_METADATA_APP_KIND = "container-metadata";
const CONTAINER_CREATE_INTENT_TYPE = "container.create";

export type ContainerCreateIntentSyncStatus = "pending" | "synced";

export interface ContainerCreateIntentRecord {
  id: string;
  containerId: string;
  parentContainerId: string;
  intentType: typeof CONTAINER_CREATE_INTENT_TYPE;
  syncStatus: ContainerCreateIntentSyncStatus;
  remoteContainerId: string | null;
  remoteMetadataDocumentId: string | null;
  remoteMetadataAccessStateHash: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContainerCreateIntentInput {
  id?: string;
  parentContainerId: string;
}

export interface StoredExplorerContainer {
  container: ContainerRecord;
  record: DocumentRecord | null;
}

export interface ExplorerPersistence {
  deleteContainer: (
    execSql: ExecSql,
    containerId: string,
    options?: { updatedAt?: string },
  ) => Promise<void>;
  deleteContainers: (
    execSql: ExecSql,
    containerIds: ReadonlyArray<string>,
    options?: { updatedAt?: string },
  ) => Promise<void>;
  deletePendingUpdates: (
    execSql: ExecSql,
    containerId: string,
  ) => Promise<void>;
  ensureSchema: (execSql: ExecSql) => Promise<void>;
  enqueuePendingUpdate: (
    execSql: ExecSql,
    input: PendingUpdateFields & { containerId: string },
  ) => Promise<void>;
  listPendingCreateIntents: (
    execSql: ExecSql,
  ) => Promise<ContainerCreateIntentRecord[]>;
  listPendingUpdates: (
    execSql: ExecSql,
    containerId: string,
  ) => Promise<PendingUpdateRecord[]>;
  recordCreateIntentError: (
    execSql: ExecSql,
    containerId: string,
    message: string,
  ) => Promise<void>;
  loadContainers: (
    execSql: ExecSql,
  ) => Promise<ReadonlyArray<StoredExplorerContainer>>;
  saveContainer: (
    execSql: ExecSql,
    container: ContainerRecord,
    record: DocumentRecord | null,
    options?: {
      createIntent?: ContainerCreateIntentInput;
      updatedAt?: string;
    },
  ) => Promise<ContainerRecord>;
  saveContainerAndDeletePendingUpdates: (
    execSql: ExecSql,
    container: ContainerRecord,
    record: DocumentRecord,
    pendingUpdateIds: readonly string[],
  ) => Promise<ContainerRecord>;
  markCreateIntentSynced: (
    execSql: ExecSql,
    input: {
      containerId: string;
      remoteContainerId: string;
      remoteMetadataAccessStateHash: string;
      remoteMetadataDocumentId: string;
    },
  ) => Promise<void>;
}

function getContainerMetadataScope(containerId: string) {
  return {
    appKind: CONTAINER_METADATA_APP_KIND,
    localId: containerId,
  };
}

function getLatestTimestamp(
  left: string | null | undefined,
  right: string | null | undefined,
): string {
  if (!left) {
    return right ?? new Date().toISOString();
  }
  if (!right) {
    return left;
  }

  return left.localeCompare(right) >= 0 ? left : right;
}

function parseCreateIntentSyncStatus(
  value: unknown,
): ContainerCreateIntentSyncStatus {
  return value === "synced" ? "synced" : "pending";
}

interface SelectedContainerCreateIntentRecord {
  id: string | null;
  containerId: string;
  parentContainerId: string;
  syncStatus: string;
  remoteContainerId: string | null;
  remoteMetadataDocumentId: string | null;
  remoteMetadataAccessStateHash: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapContainerCreateIntentRecord(
  row: SelectedContainerCreateIntentRecord,
): ContainerCreateIntentRecord {
  return {
    id: String(row.id ?? ""),
    containerId: row.containerId,
    parentContainerId: row.parentContainerId,
    intentType: CONTAINER_CREATE_INTENT_TYPE,
    syncStatus: parseCreateIntentSyncStatus(row.syncStatus),
    remoteContainerId: row.remoteContainerId,
    remoteMetadataDocumentId: row.remoteMetadataDocumentId,
    remoteMetadataAccessStateHash: row.remoteMetadataAccessStateHash,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function saveContainerMetadataRecord(input: {
  containerId: string;
  record: DocumentRecord;
  tx: AppSQLiteTransaction;
  updatedAt: string;
}) {
  const { containerId, record, tx, updatedAt } = input;
  const nextRow = {
    appKind: CONTAINER_METADATA_APP_KIND,
    localId: containerId,
    documentId: record.documentId,
    loroSnapshot: record.loroSnapshot,
    accessEpoch: record.accessEpoch,
    accessStateHash: record.accessStateHash ?? null,
    lastCommitLsn: record.lastCommitLsn ?? null,
    documentManifestBundle: record.documentManifestBundle ?? null,
    contentKeyBundle: record.contentKeyBundle ?? null,
    documentKekTargets: record.documentKekTargets ?? null,
    updatedAt,
  };

  await tx
    .insert(documents)
    .values(nextRow)
    .onConflictDoUpdate({
      target: [documents.appKind, documents.localId],
      set: nextRow,
    })
    .run();
}

async function saveExplorerContainerRows(input: {
  container: ContainerRecord;
  createIntent?: ContainerCreateIntentInput | undefined;
  record: DocumentRecord | null;
  tx: AppSQLiteTransaction;
  updatedAt: string;
}): Promise<ContainerRecord> {
  const { container, createIntent, record, tx, updatedAt } = input;
  const nextContainer = {
    ...container,
    createdAt: container.createdAt ?? updatedAt,
    updatedAt,
  };

  await saveContainerRows({
    record: nextContainer,
    tx,
    updatedAt,
  });

  if (record) {
    await saveContainerMetadataRecord({
      containerId: container.id,
      record: {
        ...record,
        id: container.id,
      },
      tx,
      updatedAt,
    });
  }

  if (createIntent) {
    await saveContainerCreateIntent({
      containerId: container.id,
      createIntent,
      tx,
      updatedAt,
    });
  }

  return nextContainer;
}

async function saveContainerCreateIntent(input: {
  tx: AppSQLiteTransaction;
  containerId: string;
  createIntent: ContainerCreateIntentInput;
  updatedAt: string;
}) {
  const { containerId, createIntent, tx, updatedAt } = input;
  await tx
    .insert(containerCreateIntents)
    .values({
      id: createIntent.id ?? crypto.randomUUID(),
      containerId,
      parentContainerId: createIntent.parentContainerId,
      intentType: CONTAINER_CREATE_INTENT_TYPE,
      syncStatus: "pending",
      remoteContainerId: null,
      remoteMetadataDocumentId: null,
      remoteMetadataAccessStateHash: null,
      lastError: null,
      createdAt: updatedAt,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: containerCreateIntents.containerId,
      set: {
        parentContainerId: createIntent.parentContainerId,
        intentType: CONTAINER_CREATE_INTENT_TYPE,
        syncStatus: "pending",
        remoteContainerId: null,
        remoteMetadataDocumentId: null,
        remoteMetadataAccessStateHash: null,
        lastError: null,
        updatedAt,
      },
    })
    .run();
}

async function repairDocumentsForRemovedContainers(input: {
  containerIds: ReadonlyArray<string>;
  execSql: ExecSql;
  updatedAt: string;
}): Promise<void> {
  const { execSql, updatedAt } = input;
  const containerIds = Array.from(new Set(input.containerIds));
  if (containerIds.length === 0) {
    return;
  }

  await ensureSqlTables(execSql, [
    ...documentContainerProjectionTables,
    ...documentProjectionTables,
  ]);

  await getAppDatabaseRuntime(execSql).transaction(async (tx) => {
    const selectedRows = await tx
      .select({
        documentId: documentProjection.documentId,
        localId: documentProjection.localId,
        updatedAt: documentProjection.updatedAt,
      })
      .from(documentProjection)
      .where(inArray(documentProjection.containerId, containerIds));

    await tx
      .delete(documentContainerProjection)
      .where(inArray(documentContainerProjection.containerId, containerIds))
      .run();

    const documentIds = Array.from(
      new Set(
        selectedRows.flatMap((row) => (row.documentId ? [row.documentId] : [])),
      ),
    );
    const remainingLinks =
      documentIds.length > 0
        ? await tx
            .select({
              containerId: documentContainerProjection.containerId,
              documentId: documentContainerProjection.documentId,
            })
            .from(documentContainerProjection)
            .where(inArray(documentContainerProjection.documentId, documentIds))
            .orderBy(
              asc(documentContainerProjection.documentId),
              asc(documentContainerProjection.containerId),
            )
        : [];
    const firstRemainingContainerIdByDocumentId = new Map<string, string>();
    for (const link of remainingLinks) {
      if (!firstRemainingContainerIdByDocumentId.has(link.documentId)) {
        firstRemainingContainerIdByDocumentId.set(
          link.documentId,
          link.containerId,
        );
      }
    }

    for (const row of selectedRows) {
      if (!row.localId) {
        continue;
      }

      await tx
        .update(documentProjection)
        .set({
          containerId: row.documentId
            ? (firstRemainingContainerIdByDocumentId.get(row.documentId) ??
              null)
            : null,
          updatedAt: getLatestTimestamp(row.updatedAt, updatedAt),
        })
        .where(eq(documentProjection.localId, row.localId))
        .run();
    }
  });
}

export const sqlExplorerPersistence: ExplorerPersistence = {
  async deleteContainer(execSql, containerId, options) {
    await sqlExplorerPersistence.deleteContainers(
      execSql,
      [containerId],
      options,
    );
  },
  async deleteContainers(execSql, containerIds, options) {
    const uniqueContainerIds = Array.from(new Set(containerIds));
    if (uniqueContainerIds.length === 0) {
      return;
    }

    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const updatedAt = options?.updatedAt ?? new Date().toISOString();
      const { db } = getAppDatabaseRuntime(lockedExecSql);
      await repairDocumentsForRemovedContainers({
        containerIds: uniqueContainerIds,
        execSql: lockedExecSql,
        updatedAt,
      });
      await db
        .delete(containerCreateIntents)
        .where(inArray(containerCreateIntents.containerId, uniqueContainerIds))
        .run();
      await deleteContainerRecords(lockedExecSql, uniqueContainerIds);
      await db
        .delete(documents)
        .where(
          and(
            eq(documents.appKind, CONTAINER_METADATA_APP_KIND),
            inArray(documents.localId, uniqueContainerIds),
          ),
        )
        .run();
      await db
        .delete(documentPendingUpdates)
        .where(
          and(
            eq(documentPendingUpdates.appKind, CONTAINER_METADATA_APP_KIND),
            inArray(documentPendingUpdates.localId, uniqueContainerIds),
          ),
        )
        .run();
      await sqlContainerSyncWatermarkPersistence.deleteWatermarksForContainers(
        lockedExecSql,
        uniqueContainerIds,
      );
    });
  },
  async deletePendingUpdates(execSql, containerId) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await deleteDocumentPendingUpdates(
        lockedExecSql,
        getContainerMetadataScope(containerId),
      );
    });
  },
  async ensureSchema(execSql) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await ensureContainerTables(lockedExecSql);
      await ensureDocumentTables(lockedExecSql);
      await ensureSqlTables(lockedExecSql, containerCreateIntentTables);
      await ensureSqlTables(lockedExecSql, documentContainerProjectionTables);
      await ensureSqlTables(lockedExecSql, documentProjectionTables);
      await sqlContainerSyncWatermarkPersistence.ensureSchema(lockedExecSql);
    });
  },
  async enqueuePendingUpdate(execSql, input) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await enqueueDocumentPendingUpdate(
        lockedExecSql,
        getContainerMetadataScope(input.containerId),
        input,
      );
    });
  },
  async listPendingUpdates(execSql, containerId) {
    return listDocumentPendingUpdates(
      execSql,
      getContainerMetadataScope(containerId),
    );
  },
  async listPendingCreateIntents(execSql) {
    const { db } = getAppDatabaseRuntime(execSql);
    const rows = await db
      .select({
        id: containerCreateIntents.id,
        containerId: containerCreateIntents.containerId,
        parentContainerId: containerCreateIntents.parentContainerId,
        syncStatus: containerCreateIntents.syncStatus,
        remoteContainerId: containerCreateIntents.remoteContainerId,
        remoteMetadataDocumentId:
          containerCreateIntents.remoteMetadataDocumentId,
        remoteMetadataAccessStateHash:
          containerCreateIntents.remoteMetadataAccessStateHash,
        lastError: containerCreateIntents.lastError,
        createdAt: containerCreateIntents.createdAt,
        updatedAt: containerCreateIntents.updatedAt,
      })
      .from(containerCreateIntents)
      .where(
        and(
          eq(containerCreateIntents.syncStatus, "pending"),
          eq(containerCreateIntents.intentType, CONTAINER_CREATE_INTENT_TYPE),
        ),
      )
      .orderBy(asc(containerCreateIntents.createdAt));

    return rows.map((row) => mapContainerCreateIntentRecord(row));
  },
  async recordCreateIntentError(execSql, containerId, message) {
    await getAppDatabaseRuntime(execSql).runMutation(async (db) => {
      await db
        .update(containerCreateIntents)
        .set({
          lastError: message,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(containerCreateIntents.containerId, containerId),
            eq(containerCreateIntents.syncStatus, "pending"),
            eq(containerCreateIntents.intentType, CONTAINER_CREATE_INTENT_TYPE),
          ),
        )
        .run();
    });
  },
  async loadContainers(execSql) {
    const containers = await loadContainerRecords(execSql);
    const storedContainers = await Promise.all(
      containers.map(async (container) => ({
        container,
        record: await loadDocumentRecord(
          execSql,
          getContainerMetadataScope(container.id),
        ),
      })),
    );

    return storedContainers;
  },
  async saveContainer(execSql, container, record, options) {
    return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const updatedAt = options?.updatedAt ?? new Date().toISOString();
      return getAppDatabaseRuntime(lockedExecSql).transaction(async (tx) =>
        saveExplorerContainerRows({
          container,
          createIntent: options?.createIntent,
          record,
          tx,
          updatedAt,
        }),
      );
    });
  },
  async saveContainerAndDeletePendingUpdates(
    execSql,
    container,
    record,
    pendingUpdateIds,
  ) {
    const uniquePendingUpdateIds = [...new Set(pendingUpdateIds)];

    return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const updatedAt = new Date().toISOString();
      return getAppDatabaseRuntime(lockedExecSql).transaction(async (tx) => {
        if (uniquePendingUpdateIds.length > 0) {
          await tx
            .delete(documentPendingUpdates)
            .where(
              and(
                eq(documentPendingUpdates.appKind, CONTAINER_METADATA_APP_KIND),
                eq(documentPendingUpdates.localId, container.id),
                inArray(documentPendingUpdates.id, uniquePendingUpdateIds),
              ),
            )
            .run();
        }

        return saveExplorerContainerRows({
          container,
          record,
          tx,
          updatedAt,
        });
      });
    });
  },
  async markCreateIntentSynced(execSql, input) {
    await getAppDatabaseRuntime(execSql).runMutation(async (db) => {
      await db
        .update(containerCreateIntents)
        .set({
          syncStatus: "synced",
          remoteContainerId: input.remoteContainerId,
          remoteMetadataDocumentId: input.remoteMetadataDocumentId,
          remoteMetadataAccessStateHash: input.remoteMetadataAccessStateHash,
          lastError: null,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(containerCreateIntents.containerId, input.containerId),
            eq(containerCreateIntents.intentType, CONTAINER_CREATE_INTENT_TYPE),
          ),
        )
        .run();
    });
  },
};
