import type { ContainerState } from "../remoteHydration";

// Collect the target and descendants leaf-first because container deletion is
// leaf-only. The enqueued set guards self/cyclic parent chains.
export function collectSubtreeLeafFirst(
  containersById: ReadonlyMap<string, ContainerState>,
  rootContainerId: string,
): ContainerState[] {
  const childIdsByParentId = new Map<string, string[]>();
  for (const containerState of containersById.values()) {
    const parentId = containerState.container.parentId;
    if (parentId === null) continue;
    const siblings = childIdsByParentId.get(parentId) ?? [];
    siblings.push(containerState.container.id);
    childIdsByParentId.set(parentId, siblings);
  }

  const ordered: ContainerState[] = [];
  const enqueued = new Set<string>([rootContainerId]);
  // Read through the queue with a head index rather than shift(): shift() is
  // O(N) per call, which would make the whole walk O(N^2).
  const queue = [rootContainerId];
  for (let head = 0; head < queue.length; head++) {
    const containerId = queue[head];
    if (containerId === undefined) continue;
    const containerState = containersById.get(containerId);
    if (containerState) ordered.push(containerState);
    for (const childId of childIdsByParentId.get(containerId) ?? []) {
      if (!enqueued.has(childId)) {
        enqueued.add(childId);
        queue.push(childId);
      }
    }
  }

  return ordered.reverse();
}
