import { and, asc, eq, inArray } from "drizzle-orm";
import {
  deleteDocumentPendingUpdates,
  enqueueDocumentPendingUpdate,
  listDocumentPendingUpdates,
  rekeyDocumentPendingUpdate,
} from "../../sqlite/documentPersistence";
import { documentPendingUpdates } from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { runSerializedSqlMutation } from "../../sqlite/sqlSchema";
import type { ContainerContentsPersistence } from "./containerContentsPersistenceTypes";
import { getContainerMetadataScope } from "./containerMetadataRows";
import { CONTAINER_METADATA_APP_KIND } from "./dormantContainerMetadata";

type ContainerPendingUpdatePersistence = Pick<
  ContainerContentsPersistence,
  | "deletePendingUpdates"
  | "enqueuePendingUpdate"
  | "listPendingUpdates"
  | "rekeyPendingUpdate"
  | "listContainerIdsWithPendingUpdates"
>;

export const containerPendingUpdatePersistence: ContainerPendingUpdatePersistence =
  {
    async deletePendingUpdates(execSql, containerId) {
      await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
        await deleteDocumentPendingUpdates(
          lockedExecSql,
          getContainerMetadataScope(containerId),
        );
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
    async rekeyPendingUpdate(execSql, id) {
      return rekeyDocumentPendingUpdate(execSql, id);
    },
    async listContainerIdsWithPendingUpdates(execSql, containerIds) {
      const uniqueContainerIds = Array.from(new Set(containerIds));
      if (uniqueContainerIds.length === 0) {
        return [];
      }

      const { db } = getClientSQLitePersistenceRuntime(execSql);
      const rows = await db
        .selectDistinct({ containerId: documentPendingUpdates.localId })
        .from(documentPendingUpdates)
        .where(
          and(
            eq(documentPendingUpdates.appKind, CONTAINER_METADATA_APP_KIND),
            inArray(documentPendingUpdates.localId, uniqueContainerIds),
          ),
        )
        .orderBy(asc(documentPendingUpdates.localId));

      return rows.map((row) => row.containerId);
    },
  };
