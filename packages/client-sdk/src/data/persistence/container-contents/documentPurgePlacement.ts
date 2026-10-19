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

export interface DocumentPlacementIntentState {
  readonly lastAttemptedAt: string | null;
  readonly localId: string;
  readonly syncStatus: string;
}

/** Every queued placement on this device; purge narrows it to its scope. */
export async function listDocumentPlacementIntentStates(
  execSql: ExecSql,
): Promise<DocumentPlacementIntentState[]> {
  await ensureSqlTables(execSql, documentPlacementIntentTables);
  const rows = await getClientSQLitePersistenceRuntime(execSql)
    .db.select({
      lastAttemptedAt: localIntents.lastAttemptedAt,
      localId: localIntents.localId,
      syncStatus: localIntents.syncStatus,
    })
    .from(localIntents)
    .where(inLocalIntentLane(LOCAL_INTENT_LANES.documentPlacement));
  return rows.flatMap(({ localId, ...row }) =>
    localId === null ? [] : [{ ...row, localId }],
  );
}
