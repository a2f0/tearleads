import {
  documentContainerProjectionTables,
  documentPlacementIntentTables,
  documentProjectionTables,
  documentTables,
  keyingCheckpointTables,
} from "../../../sqlite/schema";
import {
  type ExecSql,
  ensureSqlTables,
  runOncePerConnection,
} from "../../../sqlite/sqlSchema";

// One ensure, so a cold connection sends three DDL messages in total.
export async function ensureDocumentsSchema(execSql: ExecSql): Promise<void> {
  await runOncePerConnection(execSql, "ensure:documents", () =>
    ensureSqlTables(execSql, [
      ...documentTables,
      ...documentProjectionTables,
      ...documentContainerProjectionTables,
      ...documentPlacementIntentTables,
      ...keyingCheckpointTables,
    ]),
  );
}
