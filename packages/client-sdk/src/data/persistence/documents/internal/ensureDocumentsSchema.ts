import {
  ensureDocumentProjectionTables,
  ensureDocumentTables,
} from "../../../sqlite/documentPersistence";
import {
  documentContainerProjectionTables,
  documentMoveIntentTables,
  keyingCheckpointTables,
} from "../../../sqlite/schema";
import {
  type ExecSql,
  ensureSqlTables,
  runOncePerConnection,
  runSerializedSqlMutation,
} from "../../../sqlite/sqlSchema";

export async function ensureDocumentsSchema(execSql: ExecSql): Promise<void> {
  await runOncePerConnection(execSql, "ensure:documents", () =>
    runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await ensureDocumentTables(lockedExecSql);
      await ensureDocumentProjectionTables(lockedExecSql);
      await ensureSqlTables(lockedExecSql, [
        ...documentContainerProjectionTables,
        ...documentMoveIntentTables,
        ...keyingCheckpointTables,
      ]);
    }),
  );
}
