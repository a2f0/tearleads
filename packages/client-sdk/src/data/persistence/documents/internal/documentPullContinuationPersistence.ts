import { DOCUMENTS_APP_KIND } from "../../../documents/documentConstants";
import { getClientSQLitePersistenceRuntime } from "../../../sqlite/sqlitePersistenceRuntime";
import { runSerializedSqlMutation } from "../../../sqlite/sqlSchema";
import { invalidateDocumentSyncPullContinuation } from "../records";
import type { DocumentsPersistence } from "../types";

export async function invalidateStoredDocumentPullContinuation(
  execSql: Parameters<DocumentsPersistence["invalidatePullContinuation"]>[0],
  input: Parameters<DocumentsPersistence["invalidatePullContinuation"]>[1],
  loadDocument: DocumentsPersistence["loadDocument"],
  loadHistoryRestoreState: DocumentsPersistence["loadHistoryRestoreState"],
) {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
    getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
      async () => {
        const invalidated = await invalidateDocumentSyncPullContinuation(
          lockedExecSql,
          {
            ...input,
            appKind: DOCUMENTS_APP_KIND,
          },
        );
        if (!invalidated) return null;
        const record = await loadDocument(lockedExecSql, input.localId);
        if (!record) return null;
        const historyRestoreState = await loadHistoryRestoreState(
          lockedExecSql,
          input.localId,
        );
        return { historyRestoreState, record };
      },
      { behavior: "immediate" },
    ),
  );
}
