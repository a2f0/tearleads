import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { and, desc, eq, type SQL, sql } from "drizzle-orm";
import {
  type RootIdentitySummary,
  rootIdentitySelection,
  toRootIdentitySummary,
} from "./identitySummary";

interface ListRootIdentitiesInput {
  /** Return identities registered strictly before this user, newest first. */
  readonly afterUserId?: string | undefined;
  readonly fingerprint?: string | undefined;
  readonly limit: number;
}

interface ListRootIdentitiesResult {
  readonly identities: RootIdentitySummary[];
  /** The last returned user id when more identities remain, else null. */
  readonly nextAfterUserId: string | null;
}

// Keyset pagination on (created_at desc, id desc). The cursor row's timestamp
// is read inside the query so the comparison keeps the database's native
// precision instead of a millisecond-truncated JavaScript Date.
function afterUserCondition(afterUserId: string): SQL {
  const cursorCreatedAt = sql`(select ${users.createdAt} from ${users} where ${users.id} = ${afterUserId})`;
  return sql`(${users.createdAt} < ${cursorCreatedAt} or (${users.createdAt} = ${cursorCreatedAt} and ${users.id} < ${afterUserId}))`;
}

export async function listRootIdentities(
  executor: DatabaseSession,
  input: ListRootIdentitiesInput,
): Promise<ListRootIdentitiesResult> {
  const conditions: SQL[] = [];
  if (input.fingerprint !== undefined) {
    conditions.push(eq(users.fingerprint, input.fingerprint));
  }
  if (input.afterUserId !== undefined) {
    conditions.push(afterUserCondition(input.afterUserId));
  }

  const rows = await executor
    .select(rootIdentitySelection)
    .from(users)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(input.limit + 1);

  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    identities: page.map(toRootIdentitySummary),
    nextAfterUserId: rows.length > input.limit && last ? last.userId : null,
  };
}
