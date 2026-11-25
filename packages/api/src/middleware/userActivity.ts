import {
  type DatabaseSession,
  db as defaultDb,
} from "@tearleads/api-shared/postgres";
import {
  organizationRosterEntries,
  users,
  userTwoFactor,
} from "@tearleads/api-shared/schema";
import {
  and,
  type Column,
  eq,
  getTableName,
  isNull,
  lt,
  or,
  type SQL,
  sql,
  type Table,
} from "drizzle-orm";

export interface UserActivityInput {
  readonly lastActiveAt: number;
  readonly userId: string;
}

export type UserActivityRecorder = (input: UserActivityInput) => Promise<void>;

/** What a stored session must be checked against after it is issued. */
export interface UserStanding {
  readonly suspended: boolean;
  /** Two-factor is on, so only a session that passed it may stand. */
  readonly twoFactorEnabled: boolean;
  /** Organizations whose administrators require two-factor sign-in. */
  readonly twoFactorRequiredOrganizationIds: readonly string[];
}

/** Resolves the user's standing, stamping activity when not suspended. */
export type UserActivityStandingRecorder = (
  input: UserActivityInput,
) => Promise<UserStanding>;

/** A column named with its table, whatever the enclosing query renders. */
function qualified(table: Table, column: Column): SQL {
  return sql`${sql.identifier(getTableName(table))}.${sql.identifier(column.name)}`;
}

const roster = organizationRosterEntries;

/**
 * The organizations requiring two-factor sign-in of the user row in scope,
 * as a correlated subquery, so a statement already reading that row carries
 * them. The partial roster index keeps it to the rows that require it. Its
 * columns are qualified by hand: a single-table query renders a selected
 * fragment's columns bare, and a bare `id` would not reach the user row.
 */
export const twoFactorRequiredOrganizationIdsSql = sql<string[]>`coalesce((
  select array_agg(${qualified(roster, roster.organizationId)}::text order by ${qualified(roster, roster.organizationId)})
  from ${roster}
  where ${qualified(roster, roster.userId)} = ${qualified(users, users.id)}
    and ${qualified(roster, roster.twoFactorRequired)}
), '{}'::text[])`;

/** Whether the user row in scope has two-factor turned on. */
export const twoFactorEnabledSql = sql<boolean>`exists (
  select 1 from ${userTwoFactor}
  where ${qualified(userTwoFactor, userTwoFactor.userId)} = ${qualified(users, users.id)}
    and ${qualified(userTwoFactor, userTwoFactor.enabledAt)} is not null
)`;

export function sameOrganizationIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const rightIds = new Set(right);
  return left.length === rightIds.size && left.every((id) => rightIds.has(id));
}

/**
 * Why a live session must renew, or null. A session that did not pass a
 * second factor holds the requirements read when it opened; once they differ
 * it renews and reads them again, so a requirement change whose session
 * sweep missed it still applies within one activity interval. Such a session
 * also stops standing once two-factor is on, even one opened while it was
 * being turned on, after that sweep listed the user's sessions.
 */
export function sessionStandingRefusal(
  session: {
    readonly twoFactorRequiredOrganizationIds: readonly string[];
    readonly twoFactorVerified: boolean;
  },
  standing: UserStanding,
): string | null {
  if (standing.suspended) return "Account suspended";
  if (!session.twoFactorVerified && standing.twoFactorEnabled) {
    return "Two-factor sign-in required";
  }
  if (
    !session.twoFactorVerified &&
    !sameOrganizationIds(
      session.twoFactorRequiredOrganizationIds,
      standing.twoFactorRequiredOrganizationIds,
    )
  ) {
    return "Two-factor requirements changed";
  }
  return null;
}

/**
 * Login and `requireAuth`'s throttled activity path:
 * one statement reads whether a platform operator suspended the user and
 * which organizations require two-factor sign-in of them and, only when not
 * suspended, moves `last_active_at` forward, never back. A suspended
 * user's row keeps its timestamp, and a user that does not exist reads as not
 * suspended, as the separate read did. A session that a suspension's sweep
 * failed to revoke is still refused within one activity interval.
 */
export function createRecordActivityUnlessSuspended(
  db: DatabaseSession,
): UserActivityStandingRecorder {
  return async ({ lastActiveAt, userId }) => {
    const seenAt = new Date(lastActiveAt);
    const advances = and(
      isNull(users.suspendedAt),
      or(isNull(users.lastActiveAt), lt(users.lastActiveAt, seenAt)),
    );
    const [row] = await db
      .update(users)
      .set({
        lastActiveAt: sql`case when ${advances} then ${sql.param(seenAt, users.lastActiveAt)} else ${users.lastActiveAt} end`,
      })
      .where(eq(users.id, userId))
      .returning({
        suspendedAt: users.suspendedAt,
        twoFactorEnabled: twoFactorEnabledSql,
        twoFactorRequiredOrganizationIds: twoFactorRequiredOrganizationIdsSql,
      });
    return {
      suspended: Boolean(row?.suspendedAt),
      twoFactorEnabled: Boolean(row?.twoFactorEnabled),
      twoFactorRequiredOrganizationIds:
        row?.twoFactorRequiredOrganizationIds ?? [],
    };
  };
}

export const recordActivityUnlessSuspended =
  createRecordActivityUnlessSuspended(defaultDb);
