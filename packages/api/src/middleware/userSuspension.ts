import {
  type DatabaseSession,
  db as defaultDb,
} from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";

export type UserSuspensionCheck = (userId: string) => Promise<boolean>;

/**
 * Whether a platform operator has suspended the user. Websocket liveness
 * checks ask, so a socket that a suspension's sweep missed closes on its next
 * check; `requireAuth` reads standing with its activity stamp instead
 * (`createRecordActivityUnlessSuspended`).
 */
function createIsUserSuspended(db: DatabaseSession): UserSuspensionCheck {
  return async (userId) => {
    const [row] = await db
      .select({ suspendedAt: users.suspendedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return Boolean(row?.suspendedAt);
  };
}

export const isUserSuspended = createIsUserSuspended(defaultDb);
