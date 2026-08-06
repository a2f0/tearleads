import { and, type Column, eq, ne, notInArray, type SQL } from "drizzle-orm";
import {
  organizationDataUsageCategories,
  organizationDataUsageSnapshots,
} from "../../sqlite/organizationDataUsageSchema";
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
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";

function inactiveUserScope(
  input: {
    readonly activeUserIds: readonly string[];
    readonly organizationId: string;
    readonly retainUserId: string;
  },
  organizationIdColumn: Column,
  userIdColumn: Column,
): SQL | undefined {
  const scope = and(
    eq(organizationIdColumn, input.organizationId),
    ne(userIdColumn, input.retainUserId),
  );
  return input.activeUserIds.length > 0
    ? and(scope, notInArray(userIdColumn, [...input.activeUserIds]))
    : scope;
}

/**
 * Retire requester rows — and the requester-scoped usage projections beside
 * them — for users the just-applied authoritative directory no longer lists as
 * active. Without this, a removed member whose identity shares the database
 * keeps presentation access until it personally sees a 403. The applying
 * requester's own rows are never pruned here: the server response that
 * carried this directory already proved that user's access.
 */
export async function pruneInactiveOrganizationRequestersInTransaction(input: {
  readonly activeUserIds: readonly string[];
  readonly organizationId: string;
  readonly retainUserId: string;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  await input.tx
    .delete(organizationReadModelRequesters)
    .where(
      inactiveUserScope(
        input,
        organizationReadModelRequesters.organizationId,
        organizationReadModelRequesters.userId,
      ),
    )
    .run();
  await input.tx
    .delete(organizationDataUsageSnapshots)
    .where(
      inactiveUserScope(
        input,
        organizationDataUsageSnapshots.organizationId,
        organizationDataUsageSnapshots.requesterUserId,
      ),
    )
    .run();
  await input.tx
    .delete(organizationDataUsageCategories)
    .where(
      inactiveUserScope(
        input,
        organizationDataUsageCategories.organizationId,
        organizationDataUsageCategories.requesterUserId,
      ),
    )
    .run();
}

/**
 * Delete the shared projection rows for one organization. By default every
 * requester row falls with them; `onlyRequesterUserId` scopes the requester
 * delete to that user for rebuilds where the shared rows are about to be
 * replaced authoritatively — other local identities keep their rows and read
 * the replacement instead of losing access until their own next reconcile.
 */
export async function purgeOrganizationReadModelProjectionInTransaction(input: {
  readonly onlyRequesterUserId?: string | undefined;
  readonly organizationId: string;
  readonly tx: ClientSQLiteTransactionScope;
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
      input.onlyRequesterUserId === undefined
        ? eq(
            organizationReadModelRequesters.organizationId,
            input.organizationId,
          )
        : and(
            eq(
              organizationReadModelRequesters.organizationId,
              input.organizationId,
            ),
            eq(
              organizationReadModelRequesters.userId,
              input.onlyRequesterUserId,
            ),
          ),
    )
    .run();
  await input.tx
    .delete(organizationReadModelState)
    .where(eq(organizationReadModelState.organizationId, input.organizationId))
    .run();
}
