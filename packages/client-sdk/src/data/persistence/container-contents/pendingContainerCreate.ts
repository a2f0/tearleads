import { and, eq } from "drizzle-orm";
import {
  inLocalIntentLane,
  LOCAL_INTENT_LANES,
  localIntents,
  localIntentTables,
} from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import { CONTAINER_CREATE_INTENT_TYPE } from "./containerContentsPersistenceTypes";

/**
 * A folder whose create has not settled can carry a listed identity that
 * adoption has not verified, or has refused; nothing is created inside it
 * until the create settles.
 */
export async function isContainerCreatePending(
  execSql: ExecSql,
  containerId: string,
): Promise<boolean> {
  await ensureSqlTables(execSql, localIntentTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const [pending] = await db
    .select({ containerId: localIntents.subjectId })
    .from(localIntents)
    .where(
      and(
        inLocalIntentLane(LOCAL_INTENT_LANES.containerCreate),
        eq(localIntents.subjectId, containerId),
        eq(localIntents.intentType, CONTAINER_CREATE_INTENT_TYPE),
        eq(localIntents.syncStatus, "pending"),
      ),
    )
    .limit(1);
  return pending !== undefined;
}
