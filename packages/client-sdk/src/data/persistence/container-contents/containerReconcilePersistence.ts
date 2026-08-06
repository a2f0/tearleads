import { ensureDocumentTables } from "../../sqlite/documentPersistence";
import {
  containerCreateIntentTables,
  containerMoveIntentTables,
  documentContainerProjectionTables,
  documentMoveIntentTables,
  documentProjectionTables,
} from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import {
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";
import { ensureContainerTables } from "../containers/containerPersistence";
import { sqlContainerSyncWatermarkPersistence } from "../containers/containerSyncWatermarkPersistence";
import type { ContainerContentsPersistence } from "./containerContentsPersistenceTypes";
import { reassignContainerDocumentsInTransaction } from "./containerDocumentReassignment";
import {
  deleteLocalContainerRows,
  reparentLocalContainerChildren,
  updateReparentedDescendantContainers,
} from "./containerStructuralRepair";

type ContainerReconcilePersistence = Pick<
  ContainerContentsPersistence,
  | "reassignContainerDocuments"
  | "reconcileLocalRootContainer"
  | "reconcileLocalSystemContainer"
>;

export const containerReconcilePersistence: ContainerReconcilePersistence = {
  async reassignContainerDocuments(execSql, input) {
    if (input.fromContainerId === input.toContainerId) {
      return;
    }

    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const updatedAt = input.updatedAt ?? new Date().toISOString();
      await ensureSqlTables(lockedExecSql, [
        ...documentContainerProjectionTables,
        ...documentMoveIntentTables,
        ...documentProjectionTables,
      ]);
      await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) => {
          await reassignContainerDocumentsInTransaction({
            fromContainerId: input.fromContainerId,
            toContainerId: input.toContainerId,
            tx,
            updatedAt,
          });
        },
      );
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
        ...containerMoveIntentTables,
        ...documentContainerProjectionTables,
        ...documentMoveIntentTables,
        ...documentProjectionTables,
      ]);
      await ensureContainerTables(lockedExecSql);
      await ensureDocumentTables(lockedExecSql);
      await sqlContainerSyncWatermarkPersistence.ensureSchema(lockedExecSql);
      await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) => {
          await updateReparentedDescendantContainers({
            descendantReparents: input.descendantReparents,
            remoteOrganizationId: input.remoteOrganizationId,
            tx,
            updatedAt,
          });
          await reassignContainerDocumentsInTransaction({
            fromContainerId: input.localRootContainerId,
            toContainerId: input.remoteRootContainerId,
            tx,
            updatedAt,
          });
          await deleteLocalContainerRows({
            containerId: input.localRootContainerId,
            tx,
          });
        },
      );
    });
  },
  async reconcileLocalSystemContainer(execSql, input) {
    if (input.localContainerId === input.remoteContainerId) {
      return;
    }

    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      const updatedAt = input.updatedAt ?? new Date().toISOString();
      await ensureSqlTables(lockedExecSql, [
        ...containerCreateIntentTables,
        ...containerMoveIntentTables,
        ...documentContainerProjectionTables,
        ...documentMoveIntentTables,
        ...documentProjectionTables,
      ]);
      await ensureContainerTables(lockedExecSql);
      await ensureDocumentTables(lockedExecSql);
      await sqlContainerSyncWatermarkPersistence.ensureSchema(lockedExecSql);
      await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) => {
          await reparentLocalContainerChildren({
            fromContainerId: input.localContainerId,
            remoteOrganizationId: input.remoteOrganizationId,
            toContainerId: input.remoteContainerId,
            tx,
            updatedAt,
          });
          await reassignContainerDocumentsInTransaction({
            fromContainerId: input.localContainerId,
            toContainerId: input.remoteContainerId,
            tx,
            updatedAt,
          });
          await deleteLocalContainerRows({
            containerId: input.localContainerId,
            tx,
          });
        },
      );
    });
  },
};
