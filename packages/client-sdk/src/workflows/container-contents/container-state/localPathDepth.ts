import { MAX_CONTAINER_PATH_LENGTH } from "@tearleads/validators/util";
import { assertContainerPathLengthFits } from "../../../data/containers/shared/containerPathLimits";

type LocalContainers = ReadonlyMap<
  string,
  { readonly container: { readonly parentId: string | null } }
>;

/** Containers from the root through `containerId`, as this device holds them. */
function localContainerPathLength(
  containersById: LocalContainers,
  containerId: string,
): number {
  const seen = new Set<string>();
  let current: string | null = containerId;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    current = containersById.get(current)?.container.parentId ?? null;
  }
  return seen.size;
}

/** Levels below `containerId` among the descendants this device holds. */
function localSubtreeHeight(
  containersById: LocalContainers,
  containerId: string,
): number {
  const childIds = new Map<string, string[]>();
  for (const [id, { container }] of containersById) {
    if (container.parentId === null) continue;
    const siblings = childIds.get(container.parentId) ?? [];
    siblings.push(id);
    childIds.set(container.parentId, siblings);
  }
  const seen = new Set([containerId]);
  let level = [containerId];
  let height = 0;
  for (;;) {
    const next = level
      .flatMap((id) => childIds.get(id) ?? [])
      .filter((id) => !seen.has(id));
    if (next.length === 0) return height;
    for (const id of next) seen.add(id);
    level = next;
    height += 1;
  }
}

/** Whether a new child of `parentId` fits, as this device holds its path. */
export function localChildPathFits(
  containersById: LocalContainers,
  parentId: string,
): boolean {
  return (
    localContainerPathLength(containersById, parentId) <
    MAX_CONTAINER_PATH_LENGTH
  );
}

/**
 * Refuse a local create before it is queued when the new child would exceed
 * the readable path length; a queued intent would otherwise never sync.
 */
export function assertLocalChildPathFits(
  containersById: LocalContainers,
  parentId: string,
): void {
  assertContainerPathLengthFits(
    localContainerPathLength(containersById, parentId) + 1,
  );
}

/**
 * Refuse a local move before it is queued when the moved subtree would exceed
 * the readable path length. The server also counts descendants this device
 * cannot see; replay abandons a move it refuses for that reason.
 */
export function assertLocalMovePathFits(
  containersById: LocalContainers,
  containerId: string,
  parentId: string,
): void {
  assertContainerPathLengthFits(
    localContainerPathLength(containersById, parentId) +
      1 +
      localSubtreeHeight(containersById, containerId),
  );
}
