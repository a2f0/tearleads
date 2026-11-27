import type { DocumentSummary } from "../../../../data/documents/documentSummary";
import { DocumentContainerProjectionRepository } from "../../../../data/persistence/container-contents/documentContainerProjectionPersistence";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { getClientSQLitePersistenceRuntime } from "../../../../data/sqlite/sqlitePersistenceRuntime";
import { runSerializedSqlMutation } from "../../../../data/sqlite/sqlSchema";
import { assertLocalPurgeScope } from "./localPurgeScope";

/** Final local scope check before HTTP dispatch, with no remote I/O under lock. */
export async function readLocalPurgeScope(
  input: Parameters<typeof assertLocalPurgeScope>[0],
  document?: DocumentSummary,
  requiredLinkedContainerId?: string,
): Promise<boolean> {
  if (requiredLinkedContainerId !== undefined) {
    await new DocumentContainerProjectionRepository(
      input.execSql,
    ).ensureSchema();
  }
  return runSerializedSqlMutation(input.execSql, async (lockedExecSql) =>
    getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
      async () => {
        await assertLocalPurgeScope({ ...input, execSql: lockedExecSql });
        if (!document) return true;
        const current = await sqlDocumentsPersistence.loadDocument(
          lockedExecSql,
          document.id,
        );
        if (
          current === null ||
          current.documentId !== document.documentId ||
          current.containerId !== document.containerId ||
          input.stillCurrent?.() === false
        ) {
          return false;
        }
        if (requiredLinkedContainerId === undefined) return true;
        if (!document.documentId) return false;
        const linked = await new DocumentContainerProjectionRepository(
          lockedExecSql,
        ).listLinkedContainerIds(document.documentId);
        return linked.includes(requiredLinkedContainerId);
      },
      { behavior: "immediate" },
    ),
  );
}
