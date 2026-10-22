import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { and, desc, eq, gte, lt, type SQL, sql } from "drizzle-orm";
import {
  type RootIdentitySummary,
  rootIdentitySelection,
  toRootIdentitySummary,
} from "./identitySummary";

interface ListRootIdentitiesInput {
  /** Return identities registered strictly before this user, newest first. */
  readonly afterUserId?: string | undefined;
  /** Lowercase hex; the full fingerprint matches exactly one identity. */
  readonly fingerprintPrefix?: string | undefined;
  readonly limit: number;
  readonly rootOnly: boolean;
  readonly userId?: string | undefined;
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

// Fingerprints are lowercase hex, and "g" sorts after every hex digit, so the
// half-open range [prefix, prefix + "g") holds exactly the fingerprints that
// start with the prefix. Unlike LIKE, a range scan can use the fingerprint's
// unique btree under any collation.
function fingerprintPrefixConditions(prefix: string): SQL[] {
  return [gte(users.fingerprint, prefix), lt(users.fingerprint, `${prefix}g`)];
}

export async function listRootIdentities(
  executor: DatabaseSession,
  input: ListRootIdentitiesInput,
): Promise<ListRootIdentitiesResult> {
  const conditions: SQL[] = [];
  if (input.fingerprintPrefix !== undefined) {
    conditions.push(...fingerprintPrefixConditions(input.fingerprintPrefix));
  }
  if (input.userId !== undefined) {
    conditions.push(eq(users.id, input.userId));
  }
  if (input.rootOnly) {
    // The bare column repeats the partial index predicate of
    // `users_root_created_at_id_idx` exactly. SQLite matches partial index
    // predicates syntactically, so `is_root = ?` would not select it.
    conditions.push(sql`${users.isRoot}`);
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
