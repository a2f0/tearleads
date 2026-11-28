import type {
  ContainerParentHydrationLane,
  QueueContainerParentLane,
} from "../types";

export function createContainerParentHydrationQueue(input: {
  containerIds: Iterable<string>;
  parentIds?: Iterable<string | null> | undefined;
  resetAllLaneWatermarks?: boolean | undefined;
  resetRootLaneWatermark?: boolean | undefined;
}): {
  lanes: ContainerParentHydrationLane[];
  queueParentLane: QueueContainerParentLane;
  unmarkSkippedParentLane: (parentId: string | null) => void;
} {
  const queuedParentIds = new Set<string>();
  const lanes: ContainerParentHydrationLane[] = [];
  const laneKeyFor = (parentId: string | null) =>
    parentId === null ? "root" : `container:${parentId}`;
  const unmarkSkippedParentLane = (parentId: string | null) => {
    queuedParentIds.delete(laneKeyFor(parentId));
  };
  const queueParentLane = (parentId: string | null) => {
    const laneKey = laneKeyFor(parentId);
    if (queuedParentIds.has(laneKey)) {
      return;
    }

    queuedParentIds.add(laneKey);
    // A restoration crawl resets every lane: a newly re-granted descendant
    // does not advance its parent's persisted watermark.
    if (input.resetAllLaneWatermarks) {
      lanes.push({ parentId, watermark: null });
      return;
    }
    lanes.push({ parentId });
    // Ordinary discovery refreshes also list the top-level lane from no
    // watermark, for its membership alone. Request ids-only first so steady
    // reconnects avoid resolving full summaries for already-held roots; the
    // hydration loop falls back to a full membership listing only if a root is
    // missing locally or gained a higher direct access level.
    if (parentId === null && input.resetRootLaneWatermark) {
      lanes.push({
        idsOnly: true,
        membershipOnly: true,
        parentId,
        skipWatermarkWrite: true,
        watermark: null,
      });
    }
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

  return { lanes, queueParentLane, unmarkSkippedParentLane };
}
