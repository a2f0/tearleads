import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  containers,
} from "@tearleads/api-shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { uniqueSortedStrings } from "../../utils/array";
import type { PrincipalReference } from "./accessLossPrincipals";

/** Container rows, paths, and current grants an access-loss pass reads. */

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

export async function loadCandidateContainersForPrincipals(input: {
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

/** Walks loaded parents upward, stopping at a cycle or an unloaded row. */
function loadedContainerPathIds(
  rowsById: ReadonlyMap<string, ContainerRow>,
  containerId: string,
): Set<string> {
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
  return pathIds;
}

export async function loadContainerPathIdsByContainerId(input: {
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
    pathIdsByContainerId.set(
      containerId,
      loadedContainerPathIds(rowsById, containerId),
    );
  }

  return pathIdsByContainerId;
}

export async function loadCurrentGrantsByContainerId(input: {
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

export function userRetainsAccessThroughPath(input: {
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
