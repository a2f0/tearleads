import { eq } from "drizzle-orm";
import { organizationDataUsageSnapshots } from "../../../data/sqlite/schema/organizationDataUsageSchema";
import {
  organizationPresentationDenials,
  organizationReadModelContainerGrants,
  organizationReadModelDirectoryUsers,
  organizationReadModelGroupMembers,
  organizationReadModelGroups,
  organizationReadModelRequesters,
  organizationReadModelState,
} from "../../../data/sqlite/schema/organizationReadModelSchema";
import type { ClientSQLiteTransactionScope } from "../../../data/sqlite/sqlitePersistenceRuntime";

// Organization Read Models' part of a remote reset: the sync remote reset runs
// inside `runOrganizationPresentationReset` and calls this in its transaction.
export { runOrganizationPresentationReset } from "./organizationPresentationAccessState";

/** Deletes every read model and presentation denial cached for the organization. */
export async function clearOrganizationReadModelsForRemoteReset(
  tx: ClientSQLiteTransactionScope,
  organizationId: string,
): Promise<void> {
  for (const table of [
    organizationDataUsageSnapshots,
    organizationReadModelContainerGrants,
    organizationReadModelGroupMembers,
    organizationReadModelDirectoryUsers,
    organizationReadModelGroups,
    organizationReadModelRequesters,
    organizationReadModelState,
    organizationPresentationDenials,
  ] as const) {
    await tx
      .delete(table)
      .where(eq(table.organizationId, organizationId))
      .run();
  }
}
