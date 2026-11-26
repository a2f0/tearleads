import { and, eq, inArray } from "drizzle-orm";
import {
  documents,
  documentTables,
} from "../../../sqlite/schema/documentRecordSchema";
import { sqliteRowsPerStatement } from "../../../sqlite/sqliteBindBudget";
import { getClientSQLitePersistenceRuntime } from "../../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../../sqlite/sqlSchema";

/**
 * The content frontier each of these records has on disk, by local id. A
 * record that is not on disk has no entry.
 */
export async function readPersistedDocumentFrontiers(
  execSql: ExecSql,
  appKind: string,
  localIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, string>> {
  const frontiers = new Map<string, string>();
  if (localIds.length === 0) return frontiers;
  await ensureSqlTables(execSql, documentTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  // One bind for the app kind; the rest carry local ids.
  const chunkSize = sqliteRowsPerStatement(1, 1);
  for (let offset = 0; offset < localIds.length; offset += chunkSize) {
    const rows = await db
      .select({
        frontier: documents.snapshotEndVersion,
        localId: documents.localId,
      })
      .from(documents)
      .where(
        and(
          eq(documents.appKind, appKind),
          inArray(
            documents.localId,
            localIds.slice(offset, offset + chunkSize),
          ),
        ),
      );
    for (const row of rows) frontiers.set(row.localId, row.frontier);
  }
  return frontiers;
}
