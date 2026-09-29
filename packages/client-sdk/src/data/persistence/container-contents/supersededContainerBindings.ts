import { and, eq } from "drizzle-orm";
import { supersededContainerBindings } from "../../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../sqlite/sqlSchema";

/** Whether a held folder was re-homed away from this organization. */
export async function isSupersededContainerBinding(
  execSql: ExecSql,
  input: { containerId: string; organizationId: string },
): Promise<boolean> {
  const rows = await getClientSQLitePersistenceRuntime(execSql)
    .db.select({ containerId: supersededContainerBindings.containerId })
    .from(supersededContainerBindings)
    .where(
      and(
        eq(supersededContainerBindings.containerId, input.containerId),
        eq(supersededContainerBindings.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Record that folders left an organization, so it can never be replayed. */
export async function recordSupersededContainerBindingsInTransaction(
  tx: ClientSQLiteTransactionScope,
  input: {
    containerIds: ReadonlyArray<string>;
    organizationId: string;
    supersededAt: string;
  },
): Promise<void> {
  if (input.containerIds.length === 0 || input.organizationId === "") return;
  await tx
    .insert(supersededContainerBindings)
    .values(
      input.containerIds.map((containerId) => ({
        containerId,
        organizationId: input.organizationId,
        supersededAt: input.supersededAt,
      })),
    )
    .onConflictDoNothing()
    .run();
}
