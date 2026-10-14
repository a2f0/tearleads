import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { listLocalIdsWithQueuedUpdates } from "../../sqlite/documentPendingUpdatePersistence";
import {
  enqueueDocumentPendingUpdate,
  listDocumentPendingUpdates,
  rekeyDocumentPendingUpdate,
  settleDocumentPendingUpdate,
  unqueueDocumentPendingUpdates,
} from "../../sqlite/documentPersistence";
import { documents } from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { runSerializedSqlMutation } from "../../sqlite/sqlSchema";
import type { ContainerContentsPersistence } from "./containerContentsPersistenceTypes";
import { getContainerMetadataScope } from "./containerMetadataRows";
import { CONTAINER_METADATA_APP_KIND } from "./dormantContainerMetadata";

type ContainerPendingUpdatePersistence = Pick<
  ContainerContentsPersistence,
  | "deletePendingUpdate"
  | "deletePendingUpdates"
  | "enqueuePendingUpdate"
  | "listPendingUpdates"
  | "rekeyPendingUpdate"
  | "listContainerIdsWithPendingUpdates"
  | "listContainerIdsWithPullContinuations"
>;

export const containerPendingUpdatePersistence: ContainerPendingUpdatePersistence =
  {
    async deletePendingUpdate(execSql, id) {
      await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
        await settleDocumentPendingUpdate(lockedExecSql, id);
      });
    },
    async deletePendingUpdates(execSql, containerId) {
      await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
        await unqueueDocumentPendingUpdates(
          lockedExecSql,
          getContainerMetadataScope(containerId),
        );
      });
    },
    async enqueuePendingUpdate(execSql, input) {
      return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
        return enqueueDocumentPendingUpdate(
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
    async rekeyPendingUpdate(execSql, id) {
      return rekeyDocumentPendingUpdate(execSql, id);
    },
    async listContainerIdsWithPendingUpdates(execSql, containerIds) {
      return listLocalIdsWithQueuedUpdates(
        getClientSQLitePersistenceRuntime(execSql).db,
        CONTAINER_METADATA_APP_KIND,
        containerIds,
      );
    },
    async listContainerIdsWithPullContinuations(execSql, containerIds) {
      const uniqueContainerIds = Array.from(new Set(containerIds));
      if (uniqueContainerIds.length === 0) {
        return [];
      }

      const { db } = getClientSQLitePersistenceRuntime(execSql);
      const rows = await db
        .select({ containerId: documents.localId })
        .from(documents)
        .where(
          and(
            eq(documents.appKind, CONTAINER_METADATA_APP_KIND),
            inArray(documents.localId, uniqueContainerIds),
            isNotNull(documents.pullContinuation),
          ),
        )
        .orderBy(asc(documents.localId));

      return rows.map((row) => row.containerId);
    },
  };
