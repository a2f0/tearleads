import { organizationDataUsageTables } from "../../sqlite/organizationDataUsageSchema";
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

export async function purgeOrganizationAccessProjection(input: {
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly requesterUserId: string;
}): Promise<void> {
  await ensureSqlTables(input.execSql, organizationAccessProjectionTables);
  await getClientSQLitePersistenceRuntime(input.execSql).transaction(
    async (tx) => {
      await purgeOrganizationReadModelProjectionInTransaction({
        organizationId: input.organizationId,
        tx,
      });
      await purgeOrganizationDataUsageProjectionInTransaction({
        organizationId: input.organizationId,
        requesterUserId: input.requesterUserId,
        tx,
      });
    },
  );
}
