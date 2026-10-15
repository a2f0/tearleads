import { and, eq } from "drizzle-orm";
import {
  documentPlacementIntentTables,
  inLocalIntentLane,
  LOCAL_INTENT_LANES,
  localIntents,
} from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";

/** Even denied or unavailable placement intent belongs to the local user. */
export async function hasUnsettledDocumentPlacement(
  execSql: ExecSql,
  localId: string,
): Promise<boolean> {
  await ensureSqlTables(execSql, documentPlacementIntentTables);
  const [intent] = await getClientSQLitePersistenceRuntime(execSql)
    .db.select({ id: localIntents.id })
    .from(localIntents)
    .where(
      and(
        inLocalIntentLane(LOCAL_INTENT_LANES.documentPlacement),
        eq(localIntents.localId, localId),
      ),
    )
    .limit(1);
  return intent !== undefined;
}
