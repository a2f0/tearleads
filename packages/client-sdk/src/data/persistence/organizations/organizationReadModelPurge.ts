import { and, eq, ne, notInArray } from "drizzle-orm";
import {
  organizationReadModelContainerGrants,
  organizationReadModelDirectoryUsers,
  organizationReadModelGroupMembers,
  organizationReadModelGroupMemberships,
  organizationReadModelGroups,
  organizationReadModelPolicyHeads,
  organizationReadModelRequesters,
  organizationReadModelState,
} from "../../sqlite/organizationReadModelSchema";
import type { ClientSQLiteTransaction } from "../../sqlite/sqlitePersistenceRuntime";

/**
 * Retire requester rows for users the just-applied authoritative directory no
 * longer lists as active. Without this, a removed member whose identity
 * shares the database keeps presentation access until it personally sees a
 * 403. The applying requester's own row is never pruned here: the server
 * response that carried this directory already proved that user's access.
 */
export async function pruneInactiveOrganizationRequestersInTransaction(input: {
  readonly activeUserIds: readonly string[];
  readonly organizationId: string;
  readonly retainUserId: string;
  readonly tx: ClientSQLiteTransaction;
}): Promise<void> {
  const scope = and(
    eq(organizationReadModelRequesters.organizationId, input.organizationId),
    ne(organizationReadModelRequesters.userId, input.retainUserId),
  );
  await input.tx
    .delete(organizationReadModelRequesters)
    .where(
      input.activeUserIds.length > 0
        ? and(
            scope,
            notInArray(organizationReadModelRequesters.userId, [
              ...input.activeUserIds,
            ]),
          )
        : scope,
    )
    .run();
}

export async function purgeOrganizationReadModelProjectionInTransaction(input: {
  readonly organizationId: string;
  readonly tx: ClientSQLiteTransaction;
}): Promise<void> {
  await input.tx
    .delete(organizationReadModelPolicyHeads)
    .where(
      eq(organizationReadModelPolicyHeads.organizationId, input.organizationId),
    )
    .run();
  await input.tx
    .delete(organizationReadModelContainerGrants)
    .where(
      eq(
        organizationReadModelContainerGrants.organizationId,
        input.organizationId,
      ),
    )
    .run();
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
