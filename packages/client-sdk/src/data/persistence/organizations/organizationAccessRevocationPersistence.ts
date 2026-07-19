import { and, eq } from "drizzle-orm";
import { organizationDataUsageTables } from "../../sqlite/organizationDataUsageSchema";
import { organizationReadModelRequesters } from "../../sqlite/organizationReadModelSchema";
import { organizationReadModelTables } from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { ensureSqlTables } from "../../sqlite/sqlTableSchema";
import { purgeOrganizationDataUsageProjectionInTransaction } from "./organizationDataUsagePersistence";
import { purgeOrganizationReadModelProjectionInTransaction } from "./organizationReadModelPurge";

const organizationAccessProjectionTables = [
  ...organizationReadModelTables,
  ...organizationDataUsageTables,
];

/**
 * Purge one requester's access to an organization's presentation projections
 * after the server denied that requester. The denial is requester-scoped: the
 * shared read-model rows stay while another local identity in the same
 * database still holds a requester row, and organization-wide rows fall with
 * the last requester.
 */
export async function purgeOrganizationAccessProjection(input: {
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly requesterUserId: string;
}): Promise<void> {
  await ensureSqlTables(input.execSql, organizationAccessProjectionTables);
  await getClientSQLitePersistenceRuntime(input.execSql).transaction(
    async (tx) => {
      await tx
        .delete(organizationReadModelRequesters)
        .where(
          and(
            eq(
              organizationReadModelRequesters.organizationId,
              input.organizationId,
            ),
            eq(organizationReadModelRequesters.userId, input.requesterUserId),
          ),
        )
        .run();
      const [remainingRequester] = await tx
        .select({ userId: organizationReadModelRequesters.userId })
        .from(organizationReadModelRequesters)
        .where(
          eq(
            organizationReadModelRequesters.organizationId,
            input.organizationId,
          ),
        )
        .limit(1);
      if (!remainingRequester) {
        await purgeOrganizationReadModelProjectionInTransaction({
          organizationId: input.organizationId,
          tx,
        });
      }
      await purgeOrganizationDataUsageProjectionInTransaction({
        organizationId: input.organizationId,
        requesterUserId: input.requesterUserId,
        tx,
      });
    },
  );
}
