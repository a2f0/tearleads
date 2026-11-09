import { and, eq } from "drizzle-orm";
import { organizationReadModelTables } from "../../sqlite/schema";
import {
  organizationReadModelRequesters,
  organizationReadModelState,
} from "../../sqlite/schema/organizationReadModelSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";

/**
 * The cursor of the stored projection this requester has applied, or null
 * when the requester holds none. Realtime hints compare against it so a hint
 * for a cursor already applied costs no read.
 */
export async function loadAppliedOrganizationReadModelCursor(input: {
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly requesterUserId: string;
}): Promise<string | null> {
  await ensureSqlTables(input.execSql, organizationReadModelTables);
  const [row] = await getClientSQLitePersistenceRuntime(input.execSql)
    .db.select({ cursor: organizationReadModelState.cursor })
    .from(organizationReadModelState)
    .innerJoin(
      organizationReadModelRequesters,
      and(
        eq(
          organizationReadModelRequesters.organizationId,
          organizationReadModelState.organizationId,
        ),
        eq(organizationReadModelRequesters.userId, input.requesterUserId),
      ),
    )
    .where(eq(organizationReadModelState.organizationId, input.organizationId))
    .limit(1);
  return row?.cursor ?? null;
}
