import {
  documentContainerProjectionTables,
  documentPlacementIntentTables,
  keyingCheckpointTables,
} from "../../../sqlite/schema";
import {
  type ExecSql,
  ensureSqlTables,
  runOncePerConnection,
  runSerializedSqlMutation,
} from "../../../sqlite/sqlSchema";
import {
  ensureDocumentProjectionTables,
  ensureDocumentTables,
} from "../records";

export async function ensureDocumentsSchema(execSql: ExecSql): Promise<void> {
  await runOncePerConnection(execSql, "ensure:documents", () =>
    runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await ensureDocumentTables(lockedExecSql);
      await ensureDocumentProjectionTables(lockedExecSql);
      await ensureSqlTables(lockedExecSql, [
        ...documentContainerProjectionTables,
        ...documentPlacementIntentTables,
        ...keyingCheckpointTables,
      ]);
    }),
  );
}
