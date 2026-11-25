import type { OrganizationReadModelDirectoryResponse } from "@tearleads/validators/response";
import { and, eq, getTableColumns, inArray } from "drizzle-orm";
import { organizationReadModelDirectoryUsers as directoryUsers } from "../../sqlite/schema/organizationReadModelSchema";
import {
  sqliteInsertBatchSize,
  sqliteRowsPerStatement,
} from "../../sqlite/sqliteBindBudget";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import { excludedValue } from "../../sqlite/sqliteUpsert";

type DirectoryRow = typeof directoryUsers.$inferSelect;

const DIRECTORY_INSERT_BATCH_SIZE = sqliteInsertBatchSize(directoryUsers);
// The organization id binds once; each removed user binds one more.
const DIRECTORY_DELETE_BATCH_SIZE = sqliteRowsPerStatement(1, 1);

// A changed row takes every non-key column from the row the delta carried.
const directoryUpsertSet = Object.fromEntries(
  Object.entries(getTableColumns(directoryUsers))
    .filter(([key]) => key !== "organizationId" && key !== "userId")
    .map(([key, column]) => [key, excludedValue(column)]),
);

/**
 * The member's leave request as stored JSON, kept only when it names this
 * organization and member. Its signature is checked when read, against the
 * member's trusted identity rather than anything the directory served.
 */
function storedLeaveRequestJson(
  organizationId: string,
  user: OrganizationReadModelDirectoryResponse["users"][number],
): string | null {
  const request = user.leaveRequest;
  return request &&
    request.organizationId === organizationId &&
    request.userId === user.userId
    ? JSON.stringify(request)
    : null;
}

function toDirectoryRows(
  directory: OrganizationReadModelDirectoryResponse,
  organizationId: string,
): DirectoryRow[] {
  return directory.users.map((user, sortOrder) => ({
    organizationId,
    userId: user.userId,
    sortOrder,
    signingKeyFingerprint: user.signingKeyFingerprint,
    encapsulationKeyFingerprint: user.encapsulationKeyFingerprint,
    isPersonalOrganizationOwner: user.isPersonalOrganizationOwner,
    createdAt: user.createdAt,
    status: user.status,
    profileDocumentId: user.profileDocumentId,
    joinedAt: user.joinedAt,
    updatedAt: user.updatedAt,
    disabledAt: user.disabledAt,
    disabledByUserId: user.disabledByUserId,
    leaveRequest: storedLeaveRequestJson(organizationId, user),
    twoFactorRequired: user.twoFactorRequired,
  }));
}

function sameDirectoryRow(
  stored: DirectoryRow | undefined,
  next: DirectoryRow,
): boolean {
  if (!stored) return false;
  return Object.entries(next).every(
    ([key, value]) => Reflect.get(stored, key) === value,
  );
}

async function insertDirectoryRows(
  tx: ClientSQLiteTransactionScope,
  rows: ReadonlyArray<DirectoryRow>,
  upsert: boolean,
): Promise<void> {
  for (
    let index = 0;
    index < rows.length;
    index += DIRECTORY_INSERT_BATCH_SIZE
  ) {
    const insert = tx
      .insert(directoryUsers)
      .values(rows.slice(index, index + DIRECTORY_INSERT_BATCH_SIZE));
    await (upsert
      ? insert.onConflictDoUpdate({
          target: [directoryUsers.organizationId, directoryUsers.userId],
          set: directoryUpsertSet,
        })
      : insert
    ).run();
  }
}

/**
 * Makes the stored directory equal the lane. A snapshot replaces every row;
 * a delta, which repeats the whole lane, writes only the rows that differ and
 * deletes users it no longer lists, so one changed member costs one row.
 */
export async function applyDirectoryLane(input: {
  readonly directory: OrganizationReadModelDirectoryResponse;
  readonly organizationId: string;
  readonly replaceAll: boolean;
  readonly tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const rows = toDirectoryRows(input.directory, input.organizationId);
  const scope = eq(directoryUsers.organizationId, input.organizationId);
  if (input.replaceAll) {
    await input.tx.delete(directoryUsers).where(scope).run();
    await insertDirectoryRows(input.tx, rows, false);
    return;
  }

  const stored = await input.tx.select().from(directoryUsers).where(scope);
  const storedByUserId = new Map(stored.map((row) => [row.userId, row]));
  const listed = new Set(rows.map((row) => row.userId));
  const removedUserIds = stored
    .map((row) => row.userId)
    .filter((userId) => !listed.has(userId));
  for (
    let index = 0;
    index < removedUserIds.length;
    index += DIRECTORY_DELETE_BATCH_SIZE
  ) {
    await input.tx
      .delete(directoryUsers)
      .where(
        and(
          scope,
          inArray(
            directoryUsers.userId,
            removedUserIds.slice(index, index + DIRECTORY_DELETE_BATCH_SIZE),
          ),
        ),
      )
      .run();
  }
  await insertDirectoryRows(
    input.tx,
    rows.filter(
      (row) => !sameDirectoryRow(storedByUserId.get(row.userId), row),
    ),
    true,
  );
}
