import {
  type DatabaseSession,
  db as defaultDb,
} from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { and, eq, isNull, lt, or } from "drizzle-orm";

export interface UserActivityInput {
  readonly lastActiveAt: number;
  readonly userId: string;
}

export type UserActivityRecorder = (input: UserActivityInput) => Promise<void>;

/**
 * Persists `users.last_active_at` so operators can see when an identity was
 * last seen across all of its sessions, not only the ones still in Redis.
 * `requireAuth` calls this on its throttled activity path (about once a
 * minute per session); the write only moves the timestamp forward so
 * concurrent sessions cannot regress it.
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

export const recordUserActivity = createRecordUserActivity(defaultDb);
