import type { DatabaseTransaction } from "@symcrypt/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  containerSyncTombstones,
  containers,
  principalMembershipProjection,
} from "@symcrypt/api-shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  getCurrentPrincipalStates,
  type StoredPrincipalState,
} from "../../access/read/principalStateStore";
import { uniqueSortedStrings } from "../../utils/array";

type ManagedPrincipalType = StoredPrincipalState["principalType"];
interface PrincipalReference {
  readonly principalId: string;
  readonly principalType: ManagedPrincipalType;
}

interface ParentPrincipalMembership {
  readonly userId: string;
  readonly principalId: string;
  readonly principalType: ManagedPrincipalType;
  readonly stateHash: string;
}

interface ContainerRow {
  readonly containerId: string;
  readonly depth: number;
  readonly organizationId: string;
  readonly parentId: string | null;
}

interface ContainerGrantRow {
  readonly containerId: string;
  readonly subjectId: string;
  readonly subjectType: string;
}

interface PrincipalPolicyAccessLossRow {
  readonly containerId: string;
  readonly depth: number;
  readonly organizationId: string;
  readonly parentId: string | null;
  readonly userId: string;
}

function principalKey(principal: PrincipalReference): string {
  return `${principal.principalType}:${principal.principalId}`;
}

function toPrincipalReference(
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
function collectCurrentAncestorPrincipals(input: {
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
async function collectCurrentPrincipalsForUsers(input: {
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

async function loadContainerRowsByIds(input: {
  readonly containerIds: Iterable<string>;
  readonly executor: DatabaseTransaction;
}): Promise<Map<string, ContainerRow>> {
  const containerIds = uniqueSortedStrings(input.containerIds);
  if (containerIds.length === 0) {
    return new Map();
  }

  const rows = await input.executor
    .select({
      containerId: containers.id,
      organizationId: containers.organizationId,
      parentId: containers.parentId,
      depth: containers.depth,
    })
    .from(containers)
    .where(inArray(containers.id, containerIds));

  return new Map(rows.map((row) => [row.containerId, row]));
}

async function loadCandidateContainersForPrincipals(input: {
  readonly executor: DatabaseTransaction;
  readonly principals: Iterable<PrincipalReference>;
}): Promise<ContainerRow[]> {
  const subjectIdsByType = new Map<string, Set<string>>();
  for (const principal of input.principals) {
    const subjectIds =
      subjectIdsByType.get(principal.principalType) ?? new Set<string>();
    subjectIds.add(principal.principalId);
    subjectIdsByType.set(principal.principalType, subjectIds);
  }

  const containerIds = new Set<string>();
  for (const [subjectType, subjectIds] of subjectIdsByType) {
    const ids = uniqueSortedStrings(subjectIds);
    if (ids.length === 0) {
      continue;
    }

    const rows = await input.executor
      .select({
        containerId: accessManifestContainerGrantProjection.containerId,
      })
      .from(accessManifestContainerGrantProjection)
      .innerJoin(
        accessManifestHeads,
        and(
          eq(accessManifestHeads.objectKind, "container"),
          eq(
            accessManifestHeads.objectId,
            accessManifestContainerGrantProjection.containerId,
          ),
          eq(
            accessManifestHeads.manifestHash,
            accessManifestContainerGrantProjection.manifestHash,
          ),
        ),
      )
      .where(
        and(
          eq(accessManifestContainerGrantProjection.subjectType, subjectType),
          inArray(accessManifestContainerGrantProjection.subjectId, ids),
        ),
      );

    for (const row of rows) {
      containerIds.add(row.containerId);
    }
  }

  const containersById = await loadContainerRowsByIds({
    containerIds,
    executor: input.executor,
  });
  return [...containersById.values()].sort((left, right) =>
    left.containerId.localeCompare(right.containerId),
  );
}

async function loadContainerPathIdsByContainerId(input: {
  readonly containerIds: readonly string[];
  readonly executor: DatabaseTransaction;
}): Promise<Map<string, Set<string>>> {
  const rowsById = new Map<string, ContainerRow>();
  let frontier = uniqueSortedStrings(input.containerIds);

  while (frontier.length > 0) {
    const unloadedIds = frontier.filter((id) => !rowsById.has(id));
    if (unloadedIds.length === 0) {
      break;
    }

    const loadedRows = await loadContainerRowsByIds({
      containerIds: unloadedIds,
      executor: input.executor,
    });
    const nextFrontier = new Set<string>();

    for (const row of loadedRows.values()) {
      rowsById.set(row.containerId, row);
      if (row.parentId && !rowsById.has(row.parentId)) {
        nextFrontier.add(row.parentId);
      }
    }

    frontier = uniqueSortedStrings(nextFrontier);
  }

  const pathIdsByContainerId = new Map<string, Set<string>>();
  for (const containerId of input.containerIds) {
    const pathIds = new Set<string>();
    const visitedIds = new Set<string>();
    let currentId: string | null = containerId;

    while (currentId && !visitedIds.has(currentId)) {
      visitedIds.add(currentId);
      const row = rowsById.get(currentId);
      if (!row) {
        break;
      }
      pathIds.add(currentId);
      currentId = row.parentId;
    }

    pathIdsByContainerId.set(containerId, pathIds);
  }

  return pathIdsByContainerId;
}

async function loadCurrentGrantsByContainerId(input: {
  readonly containerIds: Iterable<string>;
  readonly executor: DatabaseTransaction;
}): Promise<Map<string, ContainerGrantRow[]>> {
  const containerIds = uniqueSortedStrings(input.containerIds);
  if (containerIds.length === 0) {
    return new Map();
  }

  const rows = await input.executor
    .select({
      containerId: accessManifestHeads.objectId,
      subjectType: accessManifestContainerGrantProjection.subjectType,
      subjectId: accessManifestContainerGrantProjection.subjectId,
    })
    .from(accessManifestHeads)
    .innerJoin(
      accessManifestContainerGrantProjection,
      and(
        eq(
          accessManifestContainerGrantProjection.manifestHash,
          accessManifestHeads.manifestHash,
        ),
        eq(
          accessManifestContainerGrantProjection.containerId,
          accessManifestHeads.objectId,
        ),
      ),
    )
    .where(
      and(
        eq(accessManifestHeads.objectKind, "container"),
        inArray(accessManifestHeads.objectId, containerIds),
      ),
    );

  const grantsByContainerId = new Map<string, ContainerGrantRow[]>();
  for (const row of rows) {
    const grants = grantsByContainerId.get(row.containerId) ?? [];
    grants.push(row);
    grantsByContainerId.set(row.containerId, grants);
  }

  return grantsByContainerId;
}

function userRetainsAccessThroughPath(input: {
  readonly grantsByContainerId: ReadonlyMap<
    string,
    readonly ContainerGrantRow[]
  >;
  readonly pathContainerIds: Iterable<string>;
  readonly userId: string;
  readonly userPrincipals: ReadonlyMap<string, PrincipalReference>;
}): boolean {
  for (const containerId of input.pathContainerIds) {
    for (const grant of input.grantsByContainerId.get(containerId) ?? []) {
      if (grant.subjectType === "user" && grant.subjectId === input.userId) {
        return true;
      }
      if (input.userPrincipals.has(`${grant.subjectType}:${grant.subjectId}`)) {
        return true;
      }
    }
  }

  return false;
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
