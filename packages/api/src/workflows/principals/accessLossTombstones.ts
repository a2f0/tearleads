import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { containerSyncTombstones } from "@tearleads/api-shared/schema";
import { sql } from "drizzle-orm";
import type { StoredPrincipalState } from "../../access/read/principalStateStore";
import { uniqueSortedStrings } from "../../utils/array";
import {
  loadCandidateContainersForPrincipals,
  loadContainerPathIdsByContainerId,
  loadCurrentGrantsByContainerId,
  userRetainsAccessThroughPath,
} from "./accessLossContainers";
import {
  collectCurrentAncestorPrincipals,
  collectCurrentPrincipalsForUsers,
  toPrincipalReference,
} from "./accessLossPrincipals";

interface PrincipalPolicyAccessLossRow {
  readonly containerId: string;
  readonly depth: number;
  readonly organizationId: string;
  readonly parentId: string | null;
  readonly userId: string;
}

async function buildPrincipalPolicyAccessLossRows(input: {
  readonly currentState: StoredPrincipalState;
  readonly currentReachableUserIds: readonly string[];
  readonly executor: DatabaseTransaction;
  readonly previousReachableUserIds: readonly string[];
}): Promise<PrincipalPolicyAccessLossRow[]> {
  const currentUserIds = new Set(input.currentReachableUserIds);
  const removedUserIds = uniqueSortedStrings(
    input.previousReachableUserIds.filter(
      (userId) => !currentUserIds.has(userId),
    ),
  );
  if (removedUserIds.length === 0) {
    return [];
  }

  const affectedPrincipals = collectCurrentAncestorPrincipals({
    seedPrincipals: [toPrincipalReference(input.currentState)],
  });
  const candidateContainers = await loadCandidateContainersForPrincipals({
    executor: input.executor,
    principals: affectedPrincipals.values(),
  });
  if (candidateContainers.length === 0) {
    return [];
  }

  const currentPrincipalsByUser = await collectCurrentPrincipalsForUsers({
    executor: input.executor,
    userIds: removedUserIds,
  });
  const pathIdsByContainerId = await loadContainerPathIdsByContainerId({
    containerIds: candidateContainers.map((container) => container.containerId),
    executor: input.executor,
  });
  const grantsByContainerId = await loadCurrentGrantsByContainerId({
    containerIds: new Set(
      [...pathIdsByContainerId.values()].flatMap((pathIds) => [...pathIds]),
    ),
    executor: input.executor,
  });
  const rows: PrincipalPolicyAccessLossRow[] = [];

  for (const userId of removedUserIds) {
    const userPrincipals = currentPrincipalsByUser.get(userId) ?? new Map();
    for (const container of candidateContainers) {
      const pathIds =
        pathIdsByContainerId.get(container.containerId) ?? new Set<string>();
      if (
        userRetainsAccessThroughPath({
          grantsByContainerId,
          pathContainerIds: pathIds,
          userId,
          userPrincipals,
        })
      ) {
        continue;
      }

      rows.push({
        containerId: container.containerId,
        depth: container.depth,
        organizationId: container.organizationId,
        parentId: container.parentId,
        userId,
      });
    }
  }

  return rows;
}

export async function persistPrincipalPolicyAccessLossTombstones(input: {
  readonly currentState: StoredPrincipalState;
  readonly currentReachableUserIds: readonly string[];
  readonly executor: DatabaseTransaction;
  readonly previousState: StoredPrincipalState | null;
  readonly previousReachableUserIds: readonly string[];
  readonly updatedAt: Date;
}): Promise<void> {
  const {
    currentReachableUserIds,
    currentState,
    executor,
    previousReachableUserIds,
    previousState,
    updatedAt,
  } = input;
  if (!previousState || previousState.stateHash === currentState.stateHash) {
    return;
  }

  const rows = await buildPrincipalPolicyAccessLossRows({
    currentReachableUserIds,
    currentState,
    executor,
    previousReachableUserIds,
  });
  if (rows.length === 0) {
    return;
  }

  const rowUpdates = {
    reason: "access_revoked" as const,
    rootDiscoveryVisible: true,
    updatedAt,
  };
  await executor
    .insert(containerSyncTombstones)
    .values(
      rows.map((row) => ({
        ...rowUpdates,
        containerId: row.containerId,
        depth: row.depth,
        organizationId: row.organizationId,
        parentId: row.parentId,
        userId: row.userId,
      })),
    )
    .onConflictDoUpdate({
      target: [
        containerSyncTombstones.userId,
        containerSyncTombstones.containerId,
      ],
      set: {
        ...rowUpdates,
        depth: sql`excluded.depth`,
        organizationId: sql`excluded.organization_id`,
        parentId: sql`excluded.parent_id`,
      },
    });
}

/**
 * The containers a principal-policy transition can affect: containers
 * granted to the principal or any current ancestor principal. The gain-side
 * tombstone prune scopes to this set, so a policy change never scans
 * tombstones beyond the grants it can actually restore.
 */
export async function candidateContainerIdsForPrincipalState(input: {
  readonly currentState: StoredPrincipalState;
  readonly executor: DatabaseTransaction;
}): Promise<string[]> {
  const affectedPrincipals = collectCurrentAncestorPrincipals({
    seedPrincipals: [toPrincipalReference(input.currentState)],
  });
  const candidateContainers = await loadCandidateContainersForPrincipals({
    executor: input.executor,
    principals: affectedPrincipals.values(),
  });
  return candidateContainers.map((container) => container.containerId);
}
