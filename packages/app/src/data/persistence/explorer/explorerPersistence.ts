import { and, asc, eq } from "drizzle-orm";
import {
  type AppSQLiteTransaction,
  getAppDatabaseRuntime,
} from "../../sqlite/appDatabaseRuntime";
import {
  type DocumentRecord,
  deleteDocumentPendingUpdate,
  deleteDocumentPendingUpdates,
  deleteDocumentRecord,
  enqueueDocumentPendingUpdate,
  ensureDocumentTables,
  listDocumentPendingUpdates,
  loadDocumentRecord,
  type PendingUpdateFields,
  type PendingUpdateRecord,
  saveDocumentRecord,
} from "../../sqlite/documentPersistence";
import {
  containerCreateIntents,
  containerCreateIntentTables,
  documentContainerProjection,
  documentContainerProjectionTables,
  documentProjection,
  documentProjectionTables,
} from "../../sqlite/schema";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";
import {
  type ContainerRecord,
  deleteContainer as deleteContainerRecord,
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
  deletePendingUpdate: (execSql: ExecSql, id: string) => Promise<void>;
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
    },
  ) => Promise<void>;
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
  execSql: ExecSql;
  containerId: string;
  record: DocumentRecord;
  updatedAt: string;
}) {
  const { containerId, execSql, record, updatedAt } = input;
  await saveDocumentRecord(
    execSql,
    {
      appKind: CONTAINER_METADATA_APP_KIND,
      localId: containerId,
    },
    record,
    updatedAt,
  );
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

async function repairDocumentsForRemovedContainer(input: {
  containerId: string;
  execSql: ExecSql;
  updatedAt: string;
}): Promise<void> {
  const { containerId, execSql, updatedAt } = input;
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
      .where(eq(documentProjection.containerId, containerId));

    await tx
      .delete(documentContainerProjection)
      .where(eq(documentContainerProjection.containerId, containerId))
      .run();

    for (const row of selectedRows) {
      if (!row.localId) {
        continue;
      }

      const remainingLinks = row.documentId
        ? await tx
            .select({ containerId: documentContainerProjection.containerId })
            .from(documentContainerProjection)
            .where(eq(documentContainerProjection.documentId, row.documentId))
            .orderBy(asc(documentContainerProjection.containerId))
            .limit(1)
        : [];

      await tx
        .update(documentProjection)
        .set({
          containerId: remainingLinks[0]?.containerId ?? null,
          updatedAt: getLatestTimestamp(row.updatedAt, updatedAt),
        })
        .where(eq(documentProjection.localId, row.localId))
        .run();
    }
  });
}

export const sqlExplorerPersistence: ExplorerPersistence = {
  async deleteContainer(execSql, containerId, options) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const updatedAt = options?.updatedAt ?? new Date().toISOString();
      const { db } = getAppDatabaseRuntime(lockedExecSql);
      await repairDocumentsForRemovedContainer({
        containerId,
        execSql: lockedExecSql,
        updatedAt,
      });
      await db
        .delete(containerCreateIntents)
        .where(eq(containerCreateIntents.containerId, containerId))
        .run();
      await deleteContainerRecord(lockedExecSql, containerId);
      await deleteDocumentRecord(
        lockedExecSql,
        getContainerMetadataScope(containerId),
      );
      await deleteDocumentPendingUpdates(
        lockedExecSql,
        getContainerMetadataScope(containerId),
      );
      await sqlContainerSyncWatermarkPersistence.deleteWatermarksForContainers(
        lockedExecSql,
        [containerId],
      );
    });
  },
  async deletePendingUpdate(execSql, id) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await deleteDocumentPendingUpdate(lockedExecSql, id);
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
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const updatedAt = new Date().toISOString();
      await getAppDatabaseRuntime(lockedExecSql).transaction(async (tx) => {
        await saveContainerRows({
          record: container,
          tx,
          updatedAt,
        });

        if (record) {
          await saveContainerMetadataRecord({
            containerId: container.id,
            execSql: lockedExecSql,
            record: {
              ...record,
              id: container.id,
            },
            updatedAt,
          });
        }

        if (options?.createIntent) {
          await saveContainerCreateIntent({
            containerId: container.id,
            createIntent: options.createIntent,
            tx,
            updatedAt,
          });
        }
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
