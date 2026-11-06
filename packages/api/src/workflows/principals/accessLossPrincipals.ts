import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { principalMembershipProjection } from "@tearleads/api-shared/schema";
import { and, inArray } from "drizzle-orm";
import {
  getCurrentPrincipalStates,
  type StoredPrincipalState,
} from "../../access/read/principalStateStore";
import { uniqueSortedStrings } from "../../utils/array";

/** Principal memberships an access-loss tombstone pass reads. */

type ManagedPrincipalType = StoredPrincipalState["principalType"];
export interface PrincipalReference {
  readonly principalId: string;
  readonly principalType: ManagedPrincipalType;
}

interface ParentPrincipalMembership {
  readonly userId: string;
  readonly principalId: string;
  readonly principalType: ManagedPrincipalType;
  readonly stateHash: string;
}

function principalKey(principal: PrincipalReference): string {
  return `${principal.principalType}:${principal.principalId}`;
}

export function toPrincipalReference(
  state: Pick<StoredPrincipalState, "principalId" | "principalType">,
): PrincipalReference {
  return {
    principalId: state.principalId,
    principalType: state.principalType,
  };
}

async function loadCurrentStatesByReference(input: {
  readonly executor: DatabaseTransaction;
  readonly principals: Iterable<PrincipalReference>;
}): Promise<Map<string, StoredPrincipalState>> {
  const principalsByType = new Map<ManagedPrincipalType, Set<string>>();

  for (const principal of input.principals) {
    const principalIds =
      principalsByType.get(principal.principalType) ?? new Set<string>();
    principalIds.add(principal.principalId);
    principalsByType.set(principal.principalType, principalIds);
  }

  const statesByKey = new Map<string, StoredPrincipalState>();
  for (const [principalType, principalIds] of principalsByType) {
    const currentStates = await getCurrentPrincipalStates(
      principalType,
      uniqueSortedStrings(principalIds),
      input.executor,
    );

    for (const state of currentStates.values()) {
      statesByKey.set(principalKey(state), state);
    }
  }

  return statesByKey;
}

async function listParentPrincipalMemberships(input: {
  readonly executor: DatabaseTransaction;
  readonly userIds: Iterable<string>;
}): Promise<ParentPrincipalMembership[]> {
  const userIds = uniqueSortedStrings(input.userIds);
  if (userIds.length === 0) {
    return [];
  }

  return input.executor
    .select({
      userId: principalMembershipProjection.userId,
      principalType: principalMembershipProjection.principalType,
      principalId: principalMembershipProjection.principalId,
      stateHash: principalMembershipProjection.stateHash,
    })
    .from(principalMembershipProjection)
    .where(and(inArray(principalMembershipProjection.userId, userIds)));
}

async function listCurrentParentPrincipalMemberships(input: {
  readonly executor: DatabaseTransaction;
  readonly userIds: Iterable<string>;
}): Promise<ParentPrincipalMembership[]> {
  const membershipRows = await listParentPrincipalMemberships(input);
  const currentStates = await loadCurrentStatesByReference({
    executor: input.executor,
    principals: membershipRows.map((row) => ({
      principalType: row.principalType,
      principalId: row.principalId,
    })),
  });

  return membershipRows.filter(
    (row) => currentStates.get(principalKey(row))?.stateHash === row.stateHash,
  );
}

/**
 * The principals whose access must be reconsidered — which is exactly the seed
 * set.
 *
 * This used to walk upward through containing principals, because a group could
 * be a member of another group and losing access to the inner one propagated
 * outward. Principals contain only users now, so a principal has no containing
 * principals and there is nothing to traverse.
 */
export function collectCurrentAncestorPrincipals(input: {
  readonly seedPrincipals: readonly PrincipalReference[];
}): Map<string, PrincipalReference> {
  return new Map(
    input.seedPrincipals.map((principal) => [
      principalKey(principal),
      principal,
    ]),
  );
}

/**
 * The principals each user currently belongs to.
 *
 * This used to be a breadth-first walk outward: a group could be a member of
 * another group, so belonging to the inner one meant belonging to the outer one
 * too. Principals contain only users now, so the seed memberships ARE the
 * answer — and re-querying with group ids against a user-id column, as the walk
 * did on its second hop, can only match by accident.
 */
export async function collectCurrentPrincipalsForUsers(input: {
  readonly executor: DatabaseTransaction;
  readonly userIds: readonly string[];
}): Promise<Map<string, Map<string, PrincipalReference>>> {
  const principalsByUserId = new Map<string, Map<string, PrincipalReference>>();
  for (const userId of input.userIds) {
    principalsByUserId.set(userId, new Map());
  }

  for (const membership of await listCurrentParentPrincipalMemberships({
    executor: input.executor,
    userIds: input.userIds,
  })) {
    const principal = {
      principalType: membership.principalType,
      principalId: membership.principalId,
    };
    principalsByUserId
      .get(membership.userId)
      ?.set(principalKey(principal), principal);
  }

  return principalsByUserId;
}
