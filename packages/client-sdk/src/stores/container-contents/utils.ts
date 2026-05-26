import type { ContainerRecord } from "../../workflows/container-contents/containerPersistence";
import { createContainerDocumentObjectSyncState } from "../../workflows/container-contents/syncState";
import type { ContainerState } from "./syncAgent";
import type { ContainerNode } from "./types";

function hasPendingContainerTimestamp(container: ContainerRecord): boolean {
  const localUpdatedAt = container.localUpdatedAt ?? null;
  const serverUpdatedAt = container.serverUpdatedAt ?? null;

  return (
    localUpdatedAt !== null &&
    (serverUpdatedAt === null ||
      localUpdatedAt.localeCompare(serverUpdatedAt) > 0)
  );
}

export function toContainerNode(containerState: ContainerState): ContainerNode {
  const { container, record } = containerState;
  const builtinKind = container.builtinKind ?? null;
  const node: ContainerNode = {
    id: container.id,
    kind: "container",
    name: container.name,
    organizationId: container.organizationId,
    parentId: container.parentId,
    syncState: createContainerDocumentObjectSyncState({
      localOnly:
        !container.serverCreatedAt ||
        !container.metadataDocumentId ||
        !record.documentId,
      pendingUpdateCount: hasPendingContainerTimestamp(container) ? 1 : 0,
    }),
  };

  if (builtinKind) {
    node.builtinKind = builtinKind;
  }

  if (container.createdAt) {
    node.createdAt = container.createdAt;
  }
  if (container.updatedAt) {
    node.updatedAt = container.updatedAt;
  }

  return node;
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
    toContainerNode(containerState),
  ).sort((left, right) =>
    left.name.localeCompare(right.name, undefined, {
      sensitivity: "base",
    }),
  );
}
