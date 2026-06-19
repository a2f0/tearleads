import type {
  ContainerParentHydrationLane,
  QueueContainerParentLane,
} from "./types";

export function createContainerParentHydrationQueue(input: {
  containerIds: Iterable<string>;
  parentIds?: Iterable<string | null> | undefined;
  resetRootLaneWatermark?: boolean | undefined;
}): {
  lanes: ContainerParentHydrationLane[];
  queueParentLane: QueueContainerParentLane;
} {
  const queuedParentIds = new Set<string>();
  const lanes: ContainerParentHydrationLane[] = [];
  const queueParentLane = (parentId: string | null) => {
    const laneKey = parentId === null ? "root" : `container:${parentId}`;
    if (queuedParentIds.has(laneKey)) {
      return;
    }

    queuedParentIds.add(laneKey);
    // `null` watermark forces an unwatermarked root re-list (see refresh()).
    lanes.push(
      parentId === null && input.resetRootLaneWatermark
        ? { parentId, watermark: null }
        : { parentId },
    );
  };

  if (input.parentIds) {
    for (const parentId of input.parentIds) {
      queueParentLane(parentId);
    }
  } else {
    queueParentLane(null);
    for (const containerId of input.containerIds) {
      queueParentLane(containerId);
    }
  }

  return { lanes, queueParentLane };
}
