import { getClientSQLitePersistenceRuntime } from "../../../sqlite/sqlitePersistenceRuntime";
import { runSerializedSqlMutation } from "../../../sqlite/sqlSchema";
import type { DocumentsPersistence } from "../types";

export async function loadStoredDocumentWithHistoryRestoreState(
  execSql: Parameters<
    DocumentsPersistence["loadDocumentWithHistoryRestoreState"]
  >[0],
  localId: string,
  persistence: Pick<
    DocumentsPersistence,
    "loadDocument" | "loadHistoryRestoreState"
  >,
): ReturnType<DocumentsPersistence["loadDocumentWithHistoryRestoreState"]> {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
    getClientSQLitePersistenceRuntime(lockedExecSql).transaction(async () => {
      const document = await persistence.loadDocument(lockedExecSql, localId);
      const historyRestoreState = await persistence.loadHistoryRestoreState(
        lockedExecSql,
        localId,
      );
      return { document, historyRestoreState };
    }),
  );
}
