import type { DocumentSummary } from "../../../data/documents/documentSummary";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import { runSerializedSqlMutation } from "../../../data/sqlite/sqlSchema";
import { assertLocalPurgeScope } from "./localPurgeScope";

/** Final local scope check before HTTP dispatch, with no remote I/O under lock. */
export function readLocalPurgeScope(
  input: Parameters<typeof assertLocalPurgeScope>[0],
  document?: DocumentSummary,
): Promise<boolean> {
  return runSerializedSqlMutation(input.execSql, async (lockedExecSql) =>
    getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
      async () => {
        await assertLocalPurgeScope({ ...input, execSql: lockedExecSql });
        if (!document) return true;
        const current = await sqlDocumentsPersistence.loadDocument(
          lockedExecSql,
          document.id,
        );
        return (
          current !== null &&
          current.documentId === document.documentId &&
          current.containerId === document.containerId &&
          input.stillCurrent?.() !== false
        );
      },
      { behavior: "immediate" },
    ),
  );
}
