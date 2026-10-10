import { eq } from "drizzle-orm";
import {
  documentMoveIntents,
  documentMoveIntentTables,
} from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";

/** Even denied or unavailable placement intent belongs to the local user. */
export async function hasUnsettledDocumentPlacement(
  execSql: ExecSql,
  localId: string,
): Promise<boolean> {
  await ensureSqlTables(execSql, documentMoveIntentTables);
  const [intent] = await getClientSQLitePersistenceRuntime(execSql)
    .db.select({ id: documentMoveIntents.id })
    .from(documentMoveIntents)
    .where(eq(documentMoveIntents.localId, localId))
    .limit(1);
  return intent !== undefined;
}
