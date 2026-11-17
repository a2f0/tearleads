import { and, type Column, eq, ne, notExists, type SQL } from "drizzle-orm";
import { organizationDataUsageSnapshots } from "../../sqlite/schema/organizationDataUsageSchema";
import {
  organizationReadModelContainerGrants,
  organizationReadModelDirectoryUsers,
  organizationReadModelGroupMembers,
  organizationReadModelGroups,
  organizationReadModelRequesters,
  organizationReadModelState,
} from "../../sqlite/schema/organizationReadModelSchema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";

/**
 * Rows for users the persisted directory does not list as active. The
 * exclusion is one anti-join against the directory rows rather than a bound
 * list, so an organization of any size fits SQLite's bound-variable budget.
 */
function inactiveUserScope(
  input: {
    readonly organizationId: string;
    readonly retainUserId: string;
    readonly tx: ClientSQLiteTransactionScope;
  },
  organizationIdColumn: Column,
  userIdColumn: Column,
): SQL | undefined {
  const directory = organizationReadModelDirectoryUsers;
  return and(
    eq(organizationIdColumn, input.organizationId),
    ne(userIdColumn, input.retainUserId),
    notExists(
      input.tx
        .select({ userId: directory.userId })
        .from(directory)
        .where(
          and(
            eq(directory.organizationId, input.organizationId),
            eq(directory.userId, userIdColumn),
            eq(directory.status, "active"),
          ),
        ),
    ),
  );
}

/**
 * Retire requester rows — and the requester-scoped usage projections beside
 * them — for users the just-applied authoritative directory no longer lists as
 * active. Without this, a removed member whose identity shares the database
 * keeps presentation access until it personally sees a 403. The applying
 * requester's own rows are never pruned here: the server response that
 * carried this directory already proved that user's access. The caller must
 * have replaced the organization's directory rows earlier in `tx`.
 */
export async function pruneInactiveOrganizationRequestersInTransaction(input: {
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
