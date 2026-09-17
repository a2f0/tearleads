import { and, eq } from "drizzle-orm";
import { organizationReadModelGroups } from "../../sqlite/organizationReadModelSchema";
import { organizationReadModelTables } from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";

export async function loadOrganizationGroupDisplayNames(
  execSql: ExecSql,
  organizationId: string,
): Promise<ReadonlyMap<string, string>> {
  await ensureSqlTables(execSql, organizationReadModelTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({
      groupId: organizationReadModelGroups.groupId,
      name: organizationReadModelGroups.name,
    })
    .from(organizationReadModelGroups)
    .where(eq(organizationReadModelGroups.organizationId, organizationId));
  return new Map(
    rows
      .filter((row) => row.name.length > 0)
      .map((row) => [row.groupId, row.name]),
  );
}

/** Local display cache only: these labels never enter a server request. */
export async function saveOrganizationGroupDisplayNames(input: {
  execSql: ExecSql;
  organizationId: string;
  names: readonly { groupId: string; name: string; stateHash: string }[];
  stillCurrent: () => boolean;
}): Promise<void> {
  await ensureSqlTables(input.execSql, organizationReadModelTables);
  await getClientSQLitePersistenceRuntime(input.execSql).guardedTransaction(
    async (tx) => {
      for (const group of input.names) {
        await tx
          .update(organizationReadModelGroups)
          .set({ name: group.name })
          .where(
            and(
              eq(
                organizationReadModelGroups.organizationId,
                input.organizationId,
              ),
              eq(organizationReadModelGroups.groupId, group.groupId),
              eq(organizationReadModelGroups.stateHash, group.stateHash),
            ),
          )
          .run();
      }
    },
    input.stillCurrent,
  );
}
