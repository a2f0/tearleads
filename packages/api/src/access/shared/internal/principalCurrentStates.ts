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
 * `principalCurrentStateKey`, in one statement per 100 principals.
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
  const unique = keys.flatMap((key) => {
    const principal = byKey.get(key);
    return principal ? [principal] : [];
  });
  const states = new Map<string, StoredPrincipalState>();
  for (
    let start = 0;
    start < unique.length;
    start += CURRENT_PRINCIPAL_HEAD_CHUNK
  ) {
    const rows = await selectCurrentPrincipalHeads(
      executor,
      unique.slice(start, start + CURRENT_PRINCIPAL_HEAD_CHUNK),
    );
    for (const row of rows) {
      const state = toStoredPrincipalState(row);
      states.set(principalCurrentStateKey(state), state);
    }
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
