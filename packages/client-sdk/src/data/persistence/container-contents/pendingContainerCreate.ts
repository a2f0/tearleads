import { and, eq } from "drizzle-orm";
import {
  containerCreateIntents,
  containerCreateIntentTables,
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
  await ensureSqlTables(execSql, containerCreateIntentTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const [pending] = await db
    .select({ containerId: containerCreateIntents.containerId })
    .from(containerCreateIntents)
    .where(
      and(
        eq(containerCreateIntents.containerId, containerId),
        eq(containerCreateIntents.intentType, CONTAINER_CREATE_INTENT_TYPE),
        eq(containerCreateIntents.syncStatus, "pending"),
      ),
    )
    .limit(1);
  return pending !== undefined;
}
