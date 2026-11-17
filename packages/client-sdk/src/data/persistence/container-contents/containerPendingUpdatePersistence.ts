import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { documents } from "../../sqlite/schema/documentRecordSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { runSerializedSqlMutation } from "../../sqlite/sqlSchema";
import { DocumentRecordRepository } from "../documents/records";
import { listLocalIdsWithQueuedUpdates } from "../documents/records/documentPendingUpdatePersistence";
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
        await new DocumentRecordRepository(
          lockedExecSql,
        ).settleDocumentPendingUpdate(id);
      });
    },
    async deletePendingUpdates(execSql, containerId) {
      await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
        await new DocumentRecordRepository(
          lockedExecSql,
        ).unqueueDocumentPendingUpdates(getContainerMetadataScope(containerId));
      });
    },
    async enqueuePendingUpdate(execSql, input) {
      return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
        return new DocumentRecordRepository(
          lockedExecSql,
        ).enqueueDocumentPendingUpdate(
          getContainerMetadataScope(input.containerId),
          input,
        );
      });
    },
    async listPendingUpdates(execSql, containerId) {
      return new DocumentRecordRepository(execSql).listDocumentPendingUpdates(
        getContainerMetadataScope(containerId),
      );
    },
    async rekeyPendingUpdate(execSql, id) {
      return new DocumentRecordRepository(execSql).rekeyDocumentPendingUpdate(
        id,
      );
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
