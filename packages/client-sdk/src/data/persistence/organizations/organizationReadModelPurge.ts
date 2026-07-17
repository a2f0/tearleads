import { eq } from "drizzle-orm";
import {
  organizationReadModelDirectoryUsers,
  organizationReadModelGroupMembers,
  organizationReadModelGroupMemberships,
  organizationReadModelGroups,
  organizationReadModelRequesters,
  organizationReadModelState,
} from "../../sqlite/organizationReadModelSchema";
import type { ClientSQLiteTransaction } from "../../sqlite/sqlitePersistenceRuntime";

export async function purgeOrganizationReadModelProjectionInTransaction(input: {
  readonly organizationId: string;
  readonly tx: ClientSQLiteTransaction;
}): Promise<void> {
  await input.tx
    .delete(organizationReadModelGroupMembers)
    .where(
      eq(
        organizationReadModelGroupMembers.organizationId,
        input.organizationId,
      ),
    )
    .run();
  await input.tx
    .delete(organizationReadModelGroupMemberships)
    .where(
      eq(
        organizationReadModelGroupMemberships.organizationId,
        input.organizationId,
      ),
    )
    .run();
  await input.tx
    .delete(organizationReadModelDirectoryUsers)
    .where(
      eq(
        organizationReadModelDirectoryUsers.organizationId,
        input.organizationId,
      ),
    )
    .run();
  await input.tx
    .delete(organizationReadModelGroups)
    .where(eq(organizationReadModelGroups.organizationId, input.organizationId))
    .run();
  await input.tx
    .delete(organizationReadModelRequesters)
    .where(
      eq(organizationReadModelRequesters.organizationId, input.organizationId),
    )
    .run();
  await input.tx
    .delete(organizationReadModelState)
    .where(eq(organizationReadModelState.organizationId, input.organizationId))
    .run();
}
