import {
  ensureDocumentProjectionTables,
  ensureDocumentTables,
} from "../../../sqlite/documentPersistence";
import { documentContainerProjectionTables } from "../../../sqlite/schema";
import {
  type ExecSql,
  ensureSqlTables,
  runOncePerConnection,
  runSerializedSqlMutation,
} from "../../../sqlite/sqlSchema";
import { deleteOrphanedDocumentSideRows } from "./orphanSideRows";

export async function ensureDocumentsSchema(execSql: ExecSql): Promise<void> {
  // Memoize read-critical DDL before best-effort maintenance so malformed
  // residue cannot make every document read fail initialization.
  await runOncePerConnection(execSql, "ensure:documents", () =>
    runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await ensureDocumentTables(lockedExecSql);
      await ensureDocumentProjectionTables(lockedExecSql);
      await ensureSqlTables(lockedExecSql, documentContainerProjectionTables);
    }),
  );
  await runOncePerConnection(execSql, "maintain:document-orphans", async () => {
    try {
      await deleteOrphanedDocumentSideRows(execSql);
    } catch {
      // A committed attachment-key queue remains durable until reclaimed.
    }
  });
}
