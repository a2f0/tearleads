import { and, eq, inArray } from "drizzle-orm";
import {
  enqueueDocumentPendingUpdate,
  ensureDocumentProjectionTables,
  ensureDocumentTables,
} from "../../sqlite/documentPersistence";
import {
  containerCreateIntentTables,
  containerHydrationTombstones,
  containerMoveIntentTables,
  containers,
  documentContainerProjectionTables,
  documentPendingUpdates,
} from "../../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import {
  ensureSqlTables,
  runOncePerConnection,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";
import {
  ensureContainerTables,
  loadContainerById,
  loadContainers as loadContainerRecords,
} from "../containers/containerPersistence";
import { sqlContainerSyncWatermarkPersistence } from "../containers/containerSyncWatermarkPersistence";
import { getLatestTimestamp } from "../latestTimestamp";
import {
  CONTAINER_METADATA_APP_KIND,
  deleteContainerMetadataDocumentRowsInTransaction,
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
  ContainerHydrationTombstone,
  ContainerMetadataRecord,
  ContainerMoveIntentRecord,
  LocalRootDescendantReparentInput,
  StoredContainerState,
} from "./containerContentsPersistenceTypes";
export { CONTAINER_METADATA_APP_KIND } from "./dormantContainerMetadata";

import type { ContainerContentsPersistence } from "./containerContentsPersistenceTypes";
import { deleteStoredContainers } from "./containerDeletionPersistence";
import { commitStoredHydratedContainer } from "./containerHydrationPersistence";
import { containerIntentPersistence } from "./containerIntentPersistence";
import {
  commitStoredMetadataMutation,
  settleStoredMetadataPendingUpdates,
} from "./containerMetadataMutationPersistence";
import { containerMetadataPullContinuationPersistence } from "./containerMetadataPullContinuationPersistence";
import {
  getContainerMetadataScope,
  saveContainerContentsContainerRows,
  selectContainerMetadataRecord,
} from "./containerMetadataRows";
import { containerPendingUpdatePersistence } from "./containerPendingUpdatePersistence";
import { containerReconcilePersistence } from "./containerReconcilePersistence";

async function hasPendingContainerMetadataUpdates(input: {
  tx: ClientSQLiteTransactionScope;
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
  ...containerMetadataPullContinuationPersistence,
  commitHydratedContainer: commitStoredHydratedContainer,
  commitMetadataMutation: commitStoredMetadataMutation,
  settleAcceptedMetadataPendingUpdates: settleStoredMetadataPendingUpdates,
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
    await sqlContainerContentsPersistence.deleteContainers(execSql, [
      {
        containerId,
        reason: options?.reason ?? "deleted",
        updatedAt: options?.updatedAt ?? new Date().toISOString(),
      },
    ]);
  },
  async deleteContainers(execSql, removals, options) {
    return deleteStoredContainers(execSql, removals, options);
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
  async loadContainerHydrationTombstones(execSql) {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const rows = await db
      .select({
        containerId: containerHydrationTombstones.containerId,
        generation: containerHydrationTombstones.generation,
        reason: containerHydrationTombstones.reason,
        updatedAt: containerHydrationTombstones.updatedAt,
      })
      .from(containerHydrationTombstones);
    return rows.flatMap((row) =>
      row.reason === "access_revoked" || row.reason === "deleted"
        ? [{ ...row, reason: row.reason }]
        : [],
    );
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
  async loadContainerMetadataState(execSql, containerId) {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    const container = await loadContainerById(execSql, containerId);
    if (!container) {
      return null;
    }
    return {
      container,
      record: await selectContainerMetadataRecord(execSql, containerId),
    };
  },
  async saveContainer(execSql, container, record, options) {
    return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const localUpdatedAt =
        options?.localUpdatedAt ??
        options?.updatedAt ??
        new Date().toISOString();
      const runtime = getClientSQLitePersistenceRuntime(lockedExecSql);
      const save = async (tx: ClientSQLiteTransactionScope) => {
        const saved = await saveContainerContentsContainerRows({
          container,
          createIntent: options?.createIntent,
          moveIntent: options?.moveIntent,
          record,
          serverTimestamps: options?.serverTimestamps,
          tx,
          localUpdatedAt,
        });
        if (options?.pendingUpdate) {
          await enqueueDocumentPendingUpdate(
            lockedExecSql,
            getContainerMetadataScope(container.id),
            options.pendingUpdate,
          );
        }
        return saved;
      };
      if (!options?.stillCurrent) {
        return runtime.transaction(save);
      }
      const outcome = await runtime.guardedTransaction(
        save,
        options.stillCurrent,
        { behavior: "immediate" },
      );
      // Guarded callers recheck the same monotonic generation immediately after
      // this await. Returning the untouched candidate keeps the long-standing
      // non-null save contract while the transaction itself remains rolled back.
      return outcome.result ?? container;
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
