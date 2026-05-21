import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import {
  type ClientSQLiteTransaction,
  getClientDatabaseRuntime,
} from "../../sqlite/clientDatabaseRuntime";
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
  containerProjection,
  containerSyncWatermarks,
  containers,
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
import {
  containerDocumentsSyncLane,
  containerParentSyncLane,
  containerSyncWatermarkLaneKey,
  sqlContainerSyncWatermarkPersistence,
} from "../containers/containerSyncWatermarkPersistence";

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

export interface LocalRootDescendantReparentInput {
  containerId: string;
  parentContainerId: string | null;
  updateCreateIntent?: boolean | undefined;
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
  reassignContainerDocuments: (
    execSql: ExecSql,
    input: {
      fromContainerId: string;
      toContainerId: string;
      updatedAt?: string | undefined;
    },
  ) => Promise<void>;
  reconcileLocalRootContainer: (
    execSql: ExecSql,
    input: {
      descendantReparents: ReadonlyArray<LocalRootDescendantReparentInput>;
      localRootContainerId: string;
      remoteOrganizationId: string;
      remoteRootContainerId: string;
      updatedAt?: string | undefined;
    },
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
      localUpdatedAt?: string;
      serverTimestamps?:
        | {
            createdAt?: string | null;
            updatedAt?: string | null;
          }
        | undefined;
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
  tx: ClientSQLiteTransaction;
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
  tx: ClientSQLiteTransaction;
  localUpdatedAt: string;
  serverTimestamps?:
    | {
        createdAt?: string | null;
        updatedAt?: string | null;
      }
    | undefined;
}): Promise<ContainerRecord> {
  const {
    container,
    createIntent,
    localUpdatedAt,
    record,
    serverTimestamps,
    tx,
  } = input;
  const nextContainer = {
    ...container,
    ...(serverTimestamps
      ? {
          serverCreatedAt:
            serverTimestamps.createdAt ?? container.serverCreatedAt ?? null,
          serverUpdatedAt:
            serverTimestamps.updatedAt ?? container.serverUpdatedAt ?? null,
        }
      : {}),
  };

  const savedContainer = await saveContainerRows({
    record: nextContainer,
    tx,
    localUpdatedAt,
  });

  if (record) {
    await saveContainerMetadataRecord({
      containerId: container.id,
      record: {
        ...record,
        id: container.id,
      },
      tx,
      updatedAt: localUpdatedAt,
    });
  }

  if (createIntent) {
    await saveContainerCreateIntent({
      containerId: container.id,
      createIntent,
      tx,
      updatedAt: localUpdatedAt,
    });
  }

  return savedContainer;
}

async function saveContainerCreateIntent(input: {
  tx: ClientSQLiteTransaction;
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

  await getClientDatabaseRuntime(execSql).transaction(async (tx) => {
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

async function reassignDocumentLinksForContainer(input: {
  fromContainerId: string;
  toContainerId: string;
  tx: ClientSQLiteTransaction;
  updatedAt: string;
}): Promise<void> {
  const { fromContainerId, toContainerId, tx, updatedAt } = input;
  await tx.run(sql`
    INSERT INTO ${documentContainerProjection} (
      ${sql.raw("document_id")},
      ${sql.raw("container_id")},
      ${sql.raw("updated_at")}
    )
    SELECT
      ${documentContainerProjection.documentId},
      ${toContainerId},
      max(${documentContainerProjection.updatedAt}, ${updatedAt})
    FROM ${documentContainerProjection}
    WHERE ${documentContainerProjection.containerId} = ${fromContainerId}
    ON CONFLICT (
      ${sql.raw("document_id")},
      ${sql.raw("container_id")}
    ) DO UPDATE SET
      ${sql.raw("updated_at")} = max(
        ${sql.raw("updated_at")},
        excluded.${sql.raw("updated_at")}
      )
  `);

  await tx
    .delete(documentContainerProjection)
    .where(eq(documentContainerProjection.containerId, fromContainerId))
    .run();
}

async function reassignPrimaryDocumentsForContainer(input: {
  fromContainerId: string;
  toContainerId: string;
  tx: ClientSQLiteTransaction;
  updatedAt: string;
}): Promise<void> {
  const { fromContainerId, toContainerId, tx, updatedAt } = input;
  await tx
    .update(documentProjection)
    .set({
      containerId: toContainerId,
      updatedAt: sql`max(${documentProjection.updatedAt}, ${updatedAt})`,
    })
    .where(eq(documentProjection.containerId, fromContainerId))
    .run();
}

async function updateReparentedDescendantContainers(input: {
  descendantReparents: ReadonlyArray<LocalRootDescendantReparentInput>;
  remoteOrganizationId: string;
  tx: ClientSQLiteTransaction;
  updatedAt: string;
}): Promise<void> {
  const { descendantReparents, remoteOrganizationId, tx, updatedAt } = input;
  const descendantIds = Array.from(
    new Set(descendantReparents.map((reparent) => reparent.containerId)),
  );
  if (descendantIds.length === 0) {
    return;
  }

  await tx
    .update(containers)
    .set({
      organizationId: remoteOrganizationId,
      localUpdatedAt: updatedAt,
    })
    .where(inArray(containers.id, descendantIds))
    .run();
  await tx
    .update(containerProjection)
    .set({ updatedAt })
    .where(inArray(containerProjection.containerId, descendantIds))
    .run();

  for (const reparent of descendantReparents) {
    await tx
      .update(containers)
      .set({ parentId: reparent.parentContainerId })
      .where(eq(containers.id, reparent.containerId))
      .run();

    if (reparent.updateCreateIntent && reparent.parentContainerId) {
      await saveContainerCreateIntent({
        containerId: reparent.containerId,
        createIntent: { parentContainerId: reparent.parentContainerId },
        tx,
        updatedAt,
      });
    }
  }
}

async function deleteLocalRootContainerRows(input: {
  localRootContainerId: string;
  tx: ClientSQLiteTransaction;
}): Promise<void> {
  const { localRootContainerId, tx } = input;
  const parentLane = containerSyncWatermarkLaneKey(
    containerParentSyncLane(localRootContainerId),
  );
  const documentsLane = containerSyncWatermarkLaneKey(
    containerDocumentsSyncLane(localRootContainerId),
  );

  await tx
    .delete(containerCreateIntents)
    .where(eq(containerCreateIntents.containerId, localRootContainerId))
    .run();
  await tx
    .delete(containerProjection)
    .where(eq(containerProjection.containerId, localRootContainerId))
    .run();
  await tx
    .delete(containers)
    .where(eq(containers.id, localRootContainerId))
    .run();
  await tx
    .delete(documents)
    .where(
      and(
        eq(documents.appKind, CONTAINER_METADATA_APP_KIND),
        eq(documents.localId, localRootContainerId),
      ),
    )
    .run();
  await tx
    .delete(documentPendingUpdates)
    .where(
      and(
        eq(documentPendingUpdates.appKind, CONTAINER_METADATA_APP_KIND),
        eq(documentPendingUpdates.localId, localRootContainerId),
      ),
    )
    .run();
  await tx
    .delete(containerSyncWatermarks)
    .where(
      or(
        and(
          eq(containerSyncWatermarks.laneKind, parentLane.laneKind),
          eq(containerSyncWatermarks.laneId, parentLane.laneId),
        ),
        and(
          eq(containerSyncWatermarks.laneKind, documentsLane.laneKind),
          eq(containerSyncWatermarks.laneId, documentsLane.laneId),
        ),
      ),
    )
    .run();
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
      const { db } = getClientDatabaseRuntime(lockedExecSql);
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
    const { db } = getClientDatabaseRuntime(execSql);
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
    await getClientDatabaseRuntime(execSql).runMutation(async (db) => {
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
  async reassignContainerDocuments(execSql, input) {
    if (input.fromContainerId === input.toContainerId) {
      return;
    }

    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const updatedAt = input.updatedAt ?? new Date().toISOString();
      await ensureSqlTables(lockedExecSql, [
        ...documentContainerProjectionTables,
        ...documentProjectionTables,
      ]);
      await getClientDatabaseRuntime(lockedExecSql).transaction(async (tx) => {
        await reassignDocumentLinksForContainer({
          fromContainerId: input.fromContainerId,
          toContainerId: input.toContainerId,
          tx,
          updatedAt,
        });
        await reassignPrimaryDocumentsForContainer({
          fromContainerId: input.fromContainerId,
          toContainerId: input.toContainerId,
          tx,
          updatedAt,
        });
      });
    });
  },
  async reconcileLocalRootContainer(execSql, input) {
    if (input.localRootContainerId === input.remoteRootContainerId) {
      return;
    }

    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const updatedAt = input.updatedAt ?? new Date().toISOString();
      await ensureSqlTables(lockedExecSql, [
        ...containerCreateIntentTables,
        ...documentContainerProjectionTables,
        ...documentProjectionTables,
      ]);
      await ensureContainerTables(lockedExecSql);
      await ensureDocumentTables(lockedExecSql);
      await sqlContainerSyncWatermarkPersistence.ensureSchema(lockedExecSql);
      await getClientDatabaseRuntime(lockedExecSql).transaction(async (tx) => {
        await updateReparentedDescendantContainers({
          descendantReparents: input.descendantReparents,
          remoteOrganizationId: input.remoteOrganizationId,
          tx,
          updatedAt,
        });
        await reassignDocumentLinksForContainer({
          fromContainerId: input.localRootContainerId,
          toContainerId: input.remoteRootContainerId,
          tx,
          updatedAt,
        });
        await reassignPrimaryDocumentsForContainer({
          fromContainerId: input.localRootContainerId,
          toContainerId: input.remoteRootContainerId,
          tx,
          updatedAt,
        });
        await deleteLocalRootContainerRows({
          localRootContainerId: input.localRootContainerId,
          tx,
        });
      });
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
      const localUpdatedAt =
        options?.localUpdatedAt ??
        options?.updatedAt ??
        new Date().toISOString();
      return getClientDatabaseRuntime(lockedExecSql).transaction(async (tx) =>
        saveExplorerContainerRows({
          container,
          createIntent: options?.createIntent,
          record,
          serverTimestamps: options?.serverTimestamps,
          tx,
          localUpdatedAt,
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
      const localUpdatedAt = new Date().toISOString();
      return getClientDatabaseRuntime(lockedExecSql).transaction(async (tx) => {
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
          localUpdatedAt,
        });
      });
    });
  },
  async markCreateIntentSynced(execSql, input) {
    await getClientDatabaseRuntime(execSql).runMutation(async (db) => {
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
