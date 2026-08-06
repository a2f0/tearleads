import { and, eq, inArray } from "drizzle-orm";
import {
  ensureDocumentProjectionTables,
  ensureDocumentTables,
} from "../../sqlite/documentPersistence";
import {
  containerCreateIntents,
  containerCreateIntentTables,
  containerMoveIntents,
  containerMoveIntentTables,
  containers,
  documentContainerProjectionTables,
  documentPendingUpdates,
} from "../../sqlite/schema";
import {
  type ClientSQLiteTransaction,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import {
  ensureSqlTables,
  runOncePerConnection,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";
import {
  deleteContainerRowsInTransaction,
  ensureContainerTables,
  loadContainers as loadContainerRecords,
} from "../containers/containerPersistence";
import {
  deleteContainerWatermarksInTransaction,
  sqlContainerSyncWatermarkPersistence,
} from "../containers/containerSyncWatermarkPersistence";
import { getLatestTimestamp } from "../latestTimestamp";
import {
  CONTAINER_METADATA_APP_KIND,
  deleteContainerMetadataDocumentRowsInTransaction,
  retainDormantContainerMetadataInTransaction,
} from "./dormantContainerMetadata";
import {
  claimDormantMetadataSweepAttempt,
  completeDormantMetadataSweepRequest,
  listDormantMetadataSweepCandidates,
  listDormantMetadataSweepRequests,
  purgeDormantContainerMetadataCandidates,
} from "./dormantMetadataSweep";

export type {
  ContainerContentsPersistence,
  ContainerCreateIntentRecord,
  ContainerMetadataRecord,
  ContainerMoveIntentRecord,
  LocalRootDescendantReparentInput,
  StoredContainerState,
} from "./containerContentsPersistenceTypes";
export { CONTAINER_METADATA_APP_KIND } from "./dormantContainerMetadata";

import type { ContainerContentsPersistence } from "./containerContentsPersistenceTypes";
import { containerIntentPersistence } from "./containerIntentPersistence";
import {
  saveContainerContentsContainerRows,
  selectContainerMetadataRecord,
} from "./containerMetadataRows";
import { containerPendingUpdatePersistence } from "./containerPendingUpdatePersistence";
import { containerReconcilePersistence } from "./containerReconcilePersistence";
import { repairDocumentsForRemovedContainersInTransaction } from "./containerStructuralRepair";

async function hasPendingContainerMetadataUpdates(input: {
  tx: ClientSQLiteTransaction;
  containerId: string;
}): Promise<boolean> {
  const rows = await input.tx
    .select({ id: documentPendingUpdates.id })
    .from(documentPendingUpdates)
    .where(
      and(
        eq(documentPendingUpdates.appKind, CONTAINER_METADATA_APP_KIND),
        eq(documentPendingUpdates.localId, input.containerId),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

export const sqlContainerContentsPersistence: ContainerContentsPersistence = {
  ...containerIntentPersistence,
  listDormantMetadataSweepRequests,
  ...containerPendingUpdatePersistence,
  ...containerReconcilePersistence,
  claimDormantMetadataSweepAttempt,
  completeDormantMetadataSweepRequest,
  async containerExists(execSql, containerId) {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const rows = await db
      .select({ id: containers.id })
      .from(containers)
      .where(eq(containers.id, containerId))
      .limit(1);
    return rows.length > 0;
  },
  async deleteContainer(execSql, containerId, options) {
    await sqlContainerContentsPersistence.deleteContainers(
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
      // Table creation (idempotent DDL) stays outside the cascade
      // transaction; every mutation below runs inside ONE transaction so a
      // crash leaves the cascade fully unapplied — the tombstone re-applies
      // it when the lane refetches — instead of stranding metadata rows
      // that re-delivered tombstones would then skip.
      await ensureSqlTables(lockedExecSql, documentContainerProjectionTables);
      await ensureDocumentProjectionTables(lockedExecSql);
      await sqlContainerSyncWatermarkPersistence.ensureSchema(lockedExecSql);
      const uniqueContainerIdSet = new Set(uniqueContainerIds);
      const retainMetadataIds = new Set(
        (options?.retainMetadataForContainerIds ?? []).filter((containerId) =>
          uniqueContainerIdSet.has(containerId),
        ),
      );
      const metadataDeleteIds = uniqueContainerIds.filter(
        (containerId) => !retainMetadataIds.has(containerId),
      );
      const retainedAt = new Date().toISOString();
      await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) => {
          const retainedContainers =
            retainMetadataIds.size === 0
              ? []
              : await tx
                  .select({
                    containerId: containers.id,
                    organizationId: containers.organizationId,
                  })
                  .from(containers)
                  .where(inArray(containers.id, Array.from(retainMetadataIds)));
          await retainDormantContainerMetadataInTransaction(
            tx,
            retainedContainers.flatMap((container) =>
              container.containerId
                ? [
                    {
                      containerId: container.containerId,
                      organizationId: container.organizationId,
                      retainedAt,
                    },
                  ]
                : [],
            ),
          );
          await repairDocumentsForRemovedContainersInTransaction({
            containerIds: uniqueContainerIds,
            tx,
            updatedAt,
          });
          await tx
            .delete(containerCreateIntents)
            .where(
              inArray(containerCreateIntents.containerId, uniqueContainerIds),
            )
            .run();
          await tx
            .delete(containerMoveIntents)
            .where(
              inArray(containerMoveIntents.containerId, uniqueContainerIds),
            )
            .run();
          await deleteContainerRowsInTransaction(tx, uniqueContainerIds);
          await deleteContainerMetadataDocumentRowsInTransaction(
            tx,
            metadataDeleteIds,
          );
          await deleteContainerWatermarksInTransaction(tx, uniqueContainerIds);
        },
      );
    });
  },
  async ensureSchema(execSql) {
    // Once ensured on this connection, skip the outer mutation lock entirely:
    // ensureSchema runs on every query path, and re-acquiring the lock just to
    // no-op would queue reads behind unrelated writes.
    await runOncePerConnection(execSql, "ensure:container-contents", () =>
      runSerializedSqlMutation(execSql, async (lockedExecSql) => {
        await ensureContainerTables(lockedExecSql);
        await ensureDocumentTables(lockedExecSql);
        await ensureSqlTables(lockedExecSql, containerCreateIntentTables);
        await ensureSqlTables(lockedExecSql, containerMoveIntentTables);
        await ensureSqlTables(lockedExecSql, documentContainerProjectionTables);
        await ensureDocumentProjectionTables(lockedExecSql);
        await sqlContainerSyncWatermarkPersistence.ensureSchema(lockedExecSql);
      }),
    );
  },
  async loadContainerMetadataRecord(execSql, containerId) {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    return selectContainerMetadataRecord(execSql, containerId);
  },
  async purgeDormantContainerMetadata(execSql, containerId) {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      // ONE transaction: a crash that deleted the documents row but kept the
      // pending updates would hide the dormant record from the next
      // hydration's mismatch check, letting dead-stream updates resurface
      // against the replacement metadata document.
      await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) => {
          await deleteContainerMetadataDocumentRowsInTransaction(tx, [
            containerId,
          ]);
        },
      );
    });
  },
  listDormantMetadataSweepCandidates,
  purgeDormantContainerMetadataCandidates,
  async loadContainers(execSql) {
    const containers = await loadContainerRecords(execSql);
    const storedContainers = await Promise.all(
      containers.map(async (container) => ({
        container,
        record: await selectContainerMetadataRecord(execSql, container.id),
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
      return getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) =>
          saveContainerContentsContainerRows({
            container,
            createIntent: options?.createIntent,
            moveIntent: options?.moveIntent,
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
      return getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) => {
          if (uniquePendingUpdateIds.length > 0) {
            await tx
              .delete(documentPendingUpdates)
              .where(
                and(
                  eq(
                    documentPendingUpdates.appKind,
                    CONTAINER_METADATA_APP_KIND,
                  ),
                  eq(documentPendingUpdates.localId, container.id),
                  inArray(documentPendingUpdates.id, uniquePendingUpdateIds),
                ),
              )
              .run();
          }

          const hasRemainingPendingUpdates =
            await hasPendingContainerMetadataUpdates({
              containerId: container.id,
              tx,
            });
          const containerToSave = hasRemainingPendingUpdates
            ? container
            : {
                ...container,
                serverUpdatedAt: getLatestTimestamp(
                  container.serverUpdatedAt,
                  localUpdatedAt,
                ),
              };

          return saveContainerContentsContainerRows({
            container: containerToSave,
            record,
            tx,
            localUpdatedAt,
          });
        },
      );
    });
  },
};
