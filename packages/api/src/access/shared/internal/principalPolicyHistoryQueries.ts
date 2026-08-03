import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  principalMemberEnvelopes,
  principalStates,
} from "@tearleads/api-shared/schema";
import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import {
  PRINCIPAL_POLICY_HISTORY_ENVELOPES_PER_STATE_LIMIT,
  PRINCIPAL_POLICY_HISTORY_GROUP_SCOPE_LIMIT,
} from "@tearleads/validators/util";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import {
  principalStateSelect,
  type StoredPrincipalState,
  toStoredPrincipalState,
} from "./principalStateRecords";

/**
 * One bounded page of a principal's signed state history, newest first.
 *
 * Deliberately separate from `listPrincipalStateHistory`, which loads the whole
 * chain and issues a projection query per state. That is tolerable on the
 * current-policy path, where the chain is read for verification and the caller
 * already needs all of it; it is not a shape to build a recovery walk on, where
 * a long-lived group's history has no ceiling.
 *
 * Fetches `limit + 1` rows so the caller can report whether more remain
 * without a second query.
 */
export async function listPrincipalStateHistoryPage(
  input: {
    /** Exclusive upper bound; omit to start from the newest state. */
    readonly beforeVersion: number | null;
    readonly limit: number;
    readonly principalId: string;
    readonly principalType: ManagedRecipientPrincipalType;
  },
  executor: DatabaseSession,
): Promise<{
  readonly hasMore: boolean;
  readonly states: StoredPrincipalState[];
}> {
  const rows = await executor
    .select(principalStateSelect)
    .from(principalStates)
    .where(
      and(
        eq(principalStates.principalType, input.principalType),
        eq(principalStates.principalId, input.principalId),
        input.beforeVersion === null
          ? undefined
          : lt(principalStates.version, input.beforeVersion),
      ),
    )
    .orderBy(desc(principalStates.version))
    .limit(input.limit + 1);

  return {
    hasMore: rows.length > input.limit,
    states: rows.slice(0, input.limit).map(toStoredPrincipalState),
  };
}

/**
 * The requester's own member envelopes across a page of states, in one query.
 *
 * Scoped to recipients the requester could actually be: their user principal,
 * and the groups that authorize them. One member's envelope is not another's
 * to read, and serving the full member set of every historical state would
 * disclose the principal's entire membership history to anyone who can read
 * its policy.
 *
 * Capped per state by a window, so a principal with unusually wide direct
 * membership cannot make one page unbounded. Recovery needs one openable
 * envelope per state, so the cap cannot cost a reachable key.
 */
export async function listPrincipalMemberEnvelopesForStates(
  input: {
    readonly memberGroupIds: readonly string[];
    readonly principalId: string;
    readonly principalType: ManagedRecipientPrincipalType;
    readonly stateHashes: readonly string[];
    readonly userId: string;
  },
  executor: DatabaseSession,
): Promise<
  Map<
    string,
    {
      readonly kemCipherText: string;
      readonly memberKeyFingerprint: string;
      readonly memberPrincipalId: string;
      readonly memberPrincipalType: "group" | "user";
      readonly wrappedKey: string;
    }[]
  >
> {
  const byStateHash = new Map<
    string,
    {
      readonly kemCipherText: string;
      readonly memberKeyFingerprint: string;
      readonly memberPrincipalId: string;
      readonly memberPrincipalType: "group" | "user";
      readonly wrappedKey: string;
    }[]
  >(input.stateHashes.map((stateHash) => [stateHash, []]));
  if (input.stateHashes.length === 0) {
    return byStateHash;
  }

  const recipientScope = or(
    and(
      eq(principalMemberEnvelopes.memberPrincipalType, "user"),
      eq(principalMemberEnvelopes.memberPrincipalId, input.userId),
    ),
    input.memberGroupIds.length > 0
      ? and(
          eq(principalMemberEnvelopes.memberPrincipalType, "group"),
          // Bounded here rather than by truncating results: the scope is what
          // determines how many envelopes a state can yield, and the per-state
          // cap is deliberately one larger so it never binds.
          inArray(principalMemberEnvelopes.memberPrincipalId, [
            ...input.memberGroupIds.slice(
              0,
              PRINCIPAL_POLICY_HISTORY_GROUP_SCOPE_LIMIT,
            ),
          ]),
        )
      : undefined,
  );
  if (!recipientScope) {
    return byStateHash;
  }

  const ranked = executor
    .select({
      kemCipherText: principalMemberEnvelopes.kemCipherText,
      memberKeyFingerprint: principalMemberEnvelopes.memberKeyFingerprint,
      memberPrincipalId: principalMemberEnvelopes.memberPrincipalId,
      memberPrincipalType: principalMemberEnvelopes.memberPrincipalType,
      stateHash: principalMemberEnvelopes.stateHash,
      wrappedKey: principalMemberEnvelopes.wrappedKey,
      stateRank: sql<number>`row_number() over (
        partition by ${principalMemberEnvelopes.stateHash}
        order by
          -- The requester's OWN envelope first: it opens from identity keys
          -- alone, with no further principal to resolve. Ordering by member
          -- type alone sorts 'group' ahead of 'user' and would spend the cap
          -- on envelopes that need another key to open.
          case when ${principalMemberEnvelopes.memberPrincipalType} = 'user' then 0 else 1 end,
          ${principalMemberEnvelopes.memberPrincipalId}
      )`.as("state_rank"),
    })
    .from(principalMemberEnvelopes)
    .where(
      and(
        eq(principalMemberEnvelopes.principalType, input.principalType),
        eq(principalMemberEnvelopes.principalId, input.principalId),
        inArray(principalMemberEnvelopes.stateHash, [...input.stateHashes]),
        recipientScope,
      ),
    )
    .as("ranked");

  // The cap is applied IN SQL. Filtering after the fetch would still
  // materialize every matching row into the application first, which is the
  // cost the cap exists to avoid.
  const rows = await executor
    .select({
      kemCipherText: ranked.kemCipherText,
      memberKeyFingerprint: ranked.memberKeyFingerprint,
      memberPrincipalId: ranked.memberPrincipalId,
      memberPrincipalType: ranked.memberPrincipalType,
      stateHash: ranked.stateHash,
      wrappedKey: ranked.wrappedKey,
    })
    .from(ranked)
    .where(
      sql`${ranked.stateRank} <= ${PRINCIPAL_POLICY_HISTORY_ENVELOPES_PER_STATE_LIMIT}`,
    );

  for (const row of rows) {
    byStateHash.get(row.stateHash)?.push({
      kemCipherText: row.kemCipherText,
      memberKeyFingerprint: row.memberKeyFingerprint,
      memberPrincipalId: row.memberPrincipalId,
      memberPrincipalType: row.memberPrincipalType,
      wrappedKey: row.wrappedKey,
    });
  }
  return byStateHash;
}
