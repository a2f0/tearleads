import type { ContainerNode } from "../../mini-apps/explorer/types";
import type { ContainerRecord } from "../../workflows/explorer";
import type { ContainerState } from "./explorerSyncAgent";

export function toContainerNode(container: ContainerRecord): ContainerNode {
  return {
    id: container.id,
    kind: "container",
    name: container.name,
    organizationId: container.organizationId,
    parentId: container.parentId,
  };
}

export function isContainerInSubtree(
  containersById: ReadonlyMap<string, ContainerState>,
  containerId: string,
  rootContainerId: string,
): boolean {
  let currentContainerId: string | null = containerId;
  const visitedContainerIds = new Set<string>();

  while (currentContainerId !== null) {
    if (currentContainerId === rootContainerId) {
      return true;
    }

    if (visitedContainerIds.has(currentContainerId)) {
      return false;
    }
    visitedContainerIds.add(currentContainerId);

    const currentContainerState = containersById.get(currentContainerId);
    currentContainerId = currentContainerState?.container.parentId ?? null;
  }

  return false;
}

export function getSnapshotNodes(
  containersById: ReadonlyMap<string, ContainerState>,
): ReadonlyArray<ContainerNode> {
  return Array.from(containersById.values(), (containerState) =>
    toContainerNode(containerState.container),
  ).sort((left, right) =>
    left.name.localeCompare(right.name, undefined, {
      sensitivity: "base",
    }),
  );
}
