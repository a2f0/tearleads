import type { LocalRootDescendantReparentInput } from "../../containerPersistence";
import { createContainerChildIndex } from "../lanes/childIndex";
import type { ContainerState, RemoteContainerHydrationState } from "../types";

/**
 * Read from the map, not a hydration pass's child index: a container created
 * while the pass runs, such as the boot's own Contacts, is missing from that
 * index, and a fold that missed it would delete its parent and strand it.
 */
function collectContainerSubtreeStates(input: {
  containersById: ReadonlyMap<string, ContainerState>;
  rootContainerId: string;
}): ContainerState[] {
  const { containersById, rootContainerId } = input;
  const subtreeStates: ContainerState[] = [];
  const pendingContainerIds = [rootContainerId];
  const enqueuedContainerIds = new Set<string>([rootContainerId]);
  const index = createContainerChildIndex(containersById);

  while (pendingContainerIds.length > 0) {
    const containerId = pendingContainerIds.pop();
    if (!containerId) {
      continue;
    }

    const childIds = index.get(containerId);
    if (!childIds) {
      continue;
    }

    for (const childId of childIds) {
      if (enqueuedContainerIds.has(childId)) {
        continue;
      }
      const childState = containersById.get(childId);
      if (!childState) {
        continue;
      }

      enqueuedContainerIds.add(childId);
      subtreeStates.push(childState);
      pendingContainerIds.push(childId);
    }
  }

  return subtreeStates;
}

/**
 * Plans a root fold's re-homes: the local root's children move onto the
 * server root, deeper descendants keep their parents, and every queued create
 * moves with its container.
 */
export function buildLocalRootDescendantReparents(input: {
  localRootState: ContainerState;
  remoteRootState: ContainerState;
  state: RemoteContainerHydrationState;
}): {
  descendantReparents: LocalRootDescendantReparentInput[];
  descendants: ContainerState[];
} {
  const { localRootState, remoteRootState, state } = input;
  const descendants = collectContainerSubtreeStates({
    containersById: state.containersById,
    rootContainerId: localRootState.container.id,
  });
  const descendantReparents = descendants.map((descendant) => {
    const previousParentId = descendant.container.parentId;
    const parentContainerId =
      previousParentId === localRootState.container.id
        ? remoteRootState.container.id
        : previousParentId;

    const updateCreateIntent =
      !descendant.record.documentId && !!parentContainerId;
    return {
      containerId: descendant.container.id,
      parentContainerId,
      updateCreateIntent,
      // The server root may already hold this slot; its listing folds the
      // copy, so the create waits for it (#3290).
      awaitParentListing:
        updateCreateIntent &&
        !!descendant.container.systemSlot &&
        previousParentId === localRootState.container.id,
    };
  });

  return { descendantReparents, descendants };
}
