import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { principalStates } from "@tearleads/api-shared/schema";
import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import { and, eq, or, type SQL, sql } from "drizzle-orm";
import { uniqueSortedStrings } from "../../../utils/array";
import {
  principalStateSelect,
  type StoredPrincipalState,
  toStoredPrincipalState,
} from "./principalStateRecords";
import {
  memoizedCurrentPrincipalState,
  rememberCurrentPrincipalState,
} from "./principalTransactionMemo";

/** Bounds the binds of one current-head read (four per principal). */
const CURRENT_PRINCIPAL_HEAD_CHUNK = 100;

/**
 * Each principal's head is one top-1 index search: the `max(version)`
 * subquery for a fixed (type, id) reads the last entry of
 * `principal_states_principal_version_idx`, and the outer arm is a point
 * lookup on the same index. Grouping every version of every requested
 * principal, as a `GROUP BY` join did, reads whole histories.
 */
function currentPrincipalHeadCondition(
  principal: Pick<StoredPrincipalState, "principalType" | "principalId">,
): SQL | undefined {
  return and(
    eq(principalStates.principalType, principal.principalType),
    eq(principalStates.principalId, principal.principalId),
    sql`${principalStates.version} = (
      select max(${principalStates.version})
      from ${principalStates}
      where ${principalStates.principalType} = ${principal.principalType}
        and ${principalStates.principalId} = ${principal.principalId}
    )`,
  );
}

/** One chunk's current-head statement; exported for its plan test. */
export function selectCurrentPrincipalHeads(
  executor: DatabaseSession,
  principals: readonly Pick<
    StoredPrincipalState,
    "principalType" | "principalId"
  >[],
) {
  return executor
    .select(principalStateSelect)
    .from(principalStates)
    .where(or(...principals.map(currentPrincipalHeadCondition)));
}

/**
 * Current heads of principals of either type, keyed by
 * `principalCurrentStateKey`, in one statement per 100 principals. As with
 * `getCurrentPrincipalState`, a principal whose mutation lock this
 * transaction holds is answered from the head it already read under that
 * lock, and only the others are queried.
 */
export async function getCurrentPrincipalStatesFor(
  principals: readonly Pick<
    StoredPrincipalState,
    "principalType" | "principalId"
  >[],
  executor: DatabaseSession,
): Promise<Map<string, StoredPrincipalState>> {
  const byKey = new Map(
    principals.map((principal) => [
      principalCurrentStateKey(principal),
      principal,
    ]),
  );
  const keys = uniqueSortedStrings([...byKey.keys()]);
  const states = new Map<string, StoredPrincipalState>();
  const misses = keys.flatMap((key) => {
    const principal = byKey.get(key);
    if (!principal) return [];
    const memoized = memoizedCurrentPrincipalState(
      executor,
      principal.principalType,
      principal.principalId,
    );
    if (memoized === undefined) return [principal];
    if (memoized) states.set(key, memoized);
    return [];
  });
  for (
    let start = 0;
    start < misses.length;
    start += CURRENT_PRINCIPAL_HEAD_CHUNK
  ) {
    const rows = await selectCurrentPrincipalHeads(
      executor,
      misses.slice(start, start + CURRENT_PRINCIPAL_HEAD_CHUNK),
    );
    for (const row of rows) {
      const state = toStoredPrincipalState(row);
      states.set(principalCurrentStateKey(state), state);
    }
  }
  for (const principal of misses) {
    rememberCurrentPrincipalState(
      executor,
      principal.principalType,
      principal.principalId,
      states.get(principalCurrentStateKey(principal)) ?? null,
    );
  }
  // Keep the sorted key order the grouped join returned.
  return new Map(
    keys.flatMap((key) => {
      const state = states.get(key);
      return state ? [[key, state] as const] : [];
    }),
  );
}

export function principalCurrentStateKey(
  principal: Pick<StoredPrincipalState, "principalType" | "principalId">,
): string {
  return `${principal.principalType}:${principal.principalId}`;
}

export async function getCurrentPrincipalStates(
  principalType: ManagedRecipientPrincipalType,
  principalIds: string[],
  executor: DatabaseSession,
): Promise<Map<string, StoredPrincipalState>> {
  const heads = await getCurrentPrincipalStatesFor(
    uniqueSortedStrings(principalIds).map((principalId) => ({
      principalType,
      principalId,
    })),
    executor,
  );
  return new Map(
    [...heads.values()].map((state) => [state.principalId, state]),
  );
}
