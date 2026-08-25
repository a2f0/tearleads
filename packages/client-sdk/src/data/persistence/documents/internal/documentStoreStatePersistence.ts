import { getClientSQLitePersistenceRuntime } from "../../../sqlite/sqlitePersistenceRuntime";
import { runSerializedSqlMutation } from "../../../sqlite/sqlSchema";
import type { DocumentsPersistence } from "../types";

export async function loadStoredDocumentStoreState(
  execSql: Parameters<DocumentsPersistence["loadDocumentStoreState"]>[0],
  localId: string,
  persistence: Pick<
    DocumentsPersistence,
    | "listLocalAttachments"
    | "listPendingAttachments"
    | "loadDocument"
    | "loadHistoryRestoreState"
  >,
): ReturnType<DocumentsPersistence["loadDocumentStoreState"]> {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
    getClientSQLitePersistenceRuntime(lockedExecSql).transaction(async () => {
      const document = await persistence.loadDocument(lockedExecSql, localId);
      const historyRestoreState = await persistence.loadHistoryRestoreState(
        lockedExecSql,
        localId,
      );
      const pendingAttachments = await persistence.listPendingAttachments(
        lockedExecSql,
        localId,
      );
      const localAttachments = await persistence.listLocalAttachments(
        lockedExecSql,
        localId,
      );
      return {
        document,
        historyRestoreState,
        localAttachments,
        pendingAttachments,
      };
    }),
  );
}
