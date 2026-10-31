import {
  type DatabaseSession,
  db as defaultDb,
} from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

export interface UserActivityInput {
  readonly lastActiveAt: number;
  readonly userId: string;
}

export type UserActivityRecorder = (input: UserActivityInput) => Promise<void>;

/** Resolves whether the user is suspended, stamping activity when not. */
export type UserActivityStandingRecorder = (
  input: UserActivityInput,
) => Promise<boolean>;

/**
 * Persists `users.last_active_at` so operators can see when an identity was
 * last seen across all of its sessions, not only the ones still stored.
 * Login calls this once per issued session; the write only moves the
 * timestamp forward so concurrent sessions cannot regress it.
 */
export function createRecordUserActivity(
  db: DatabaseSession,
): UserActivityRecorder {
  return async ({ lastActiveAt, userId }) => {
    const seenAt = new Date(lastActiveAt);
    await db
      .update(users)
      .set({ lastActiveAt: seenAt })
      .where(
        and(
          eq(users.id, userId),
          or(isNull(users.lastActiveAt), lt(users.lastActiveAt, seenAt)),
        ),
      );
  };
}

/**
 * `requireAuth`'s throttled activity path (about once a minute per session):
 * one statement reads whether a platform operator suspended the user and,
 * only when not, moves `last_active_at` forward, never back. A suspended
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
      .returning({ suspendedAt: users.suspendedAt });
    return Boolean(row?.suspendedAt);
  };
}

export const recordUserActivity = createRecordUserActivity(defaultDb);

export const recordActivityUnlessSuspended =
  createRecordActivityUnlessSuspended(defaultDb);
