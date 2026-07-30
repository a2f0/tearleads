import type {
  ContainerParentHydrationLane,
  QueueContainerParentLane,
} from "./types";

export function createContainerParentHydrationQueue(input: {
  containerIds: Iterable<string>;
  parentIds?: Iterable<string | null> | undefined;
  resetAllLaneWatermarks?: boolean | undefined;
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
    // A restoration crawl resets every lane: a newly re-granted descendant
    // does not advance its parent's persisted watermark. Ordinary discovery
    // refreshes only need to reset the top-level lane.
    const resetWatermark =
      input.resetAllLaneWatermarks ||
      (parentId === null && input.resetRootLaneWatermark);
    lanes.push(resetWatermark ? { parentId, watermark: null } : { parentId });
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
