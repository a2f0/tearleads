import { and, eq } from "drizzle-orm";
import { organizationReadModelTables } from "../../sqlite/schema";
import {
  organizationReadModelRequesters,
  organizationReadModelState,
} from "../../sqlite/schema/organizationReadModelSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";

/**
 * The cursor this requester has applied, or null when it holds none. The
 * organization row's cursor is shared: another identity on this device may
 * have advanced it while this requester's own fields (for example
 * `isOrgAdmin`) still reflect an older response. Only the requester's own
 * applied cursor, while it is still the stored projection's cursor, proves
 * this requester is current. Realtime hints compare against it so a hint for
 * a cursor already applied costs no read.
 */
export async function loadAppliedOrganizationReadModelCursor(input: {
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly requesterUserId: string;
}): Promise<string | null> {
  await ensureSqlTables(input.execSql, organizationReadModelTables);
  const [row] = await getClientSQLitePersistenceRuntime(input.execSql)
    .db.select({ cursor: organizationReadModelRequesters.appliedCursor })
    .from(organizationReadModelRequesters)
    .innerJoin(
      organizationReadModelState,
      and(
        eq(
          organizationReadModelState.organizationId,
          organizationReadModelRequesters.organizationId,
        ),
        eq(
          organizationReadModelState.cursor,
          organizationReadModelRequesters.appliedCursor,
        ),
      ),
    )
    .where(
      and(
        eq(
          organizationReadModelRequesters.organizationId,
          input.organizationId,
        ),
        eq(organizationReadModelRequesters.userId, input.requesterUserId),
      ),
    )
    .limit(1);
  return row?.cursor ?? null;
}
