import type { ContainerChildIndex, ContainerState } from "./types";

export function addIndexedContainerChild(
  childIdsByParentId: ContainerChildIndex,
  containerId: string,
  parentId: string | null,
) {
  if (parentId === null) {
    return;
  }

  const childIds = childIdsByParentId.get(parentId) ?? new Set<string>();
  childIds.add(containerId);
  childIdsByParentId.set(parentId, childIds);
}

export function removeIndexedContainerChild(
  childIdsByParentId: ContainerChildIndex,
  containerId: string,
  parentId: string | null,
) {
  if (parentId === null) {
    return;
  }

  const childIds = childIdsByParentId.get(parentId);
  if (!childIds) {
    return;
  }

  childIds.delete(containerId);
  if (childIds.size === 0) {
    childIdsByParentId.delete(parentId);
  }
}

export function moveIndexedContainerChild(
  childIdsByParentId: ContainerChildIndex | undefined,
  containerId: string,
  previousParentId: string | null,
  nextParentId: string | null,
) {
  if (!childIdsByParentId || previousParentId === nextParentId) {
    return;
  }

  removeIndexedContainerChild(
    childIdsByParentId,
    containerId,
    previousParentId,
  );
  addIndexedContainerChild(childIdsByParentId, containerId, nextParentId);
}

export function createContainerChildIndex(
  containersById: ReadonlyMap<string, ContainerState>,
): ContainerChildIndex {
  const childIdsByParentId: ContainerChildIndex = new Map();

  for (const [containerId, containerState] of containersById) {
    addIndexedContainerChild(
      childIdsByParentId,
      containerId,
      containerState.container.parentId,
    );
  }

  return childIdsByParentId;
}
