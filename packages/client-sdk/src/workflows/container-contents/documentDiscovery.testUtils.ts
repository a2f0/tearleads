import type {
  ContainerDocumentDiscoveryApi,
  ContainerDocumentPlacement,
  ContainerDocumentTombstone,
  ContainerDocumentTombstoneVerdict,
  ListContainersResponse,
} from "./documentDiscoveryTypes";

/** Every listing tombstone is treated as verified; no holds are stored. */
export const trustedContainerDocumentTombstones = {
  holdContainerDocumentTombstones: async () => {},
  listHeldContainerDocumentTombstones: async () => [],
  listKnownContainerDocumentPlacements: async (
    placements: ReadonlyArray<ContainerDocumentPlacement>,
  ) => placements,
  releaseContainerDocumentTombstoneHolds: async () => {},
  verifyContainerDocumentTombstones: async (
    tombstones: ReadonlyArray<ContainerDocumentTombstone>,
  ): Promise<ContainerDocumentTombstoneVerdict[]> =>
    tombstones.map((tombstone) => ({
      kind: "verified",
      tombstone: { ...tombstone, linkedContainerIds: [] },
    })),
};

export const nullContainerDocumentWatermarks = {
  ...trustedContainerDocumentTombstones,
  applyContainerDocumentTombstones: async () => [],
  loadContainerDocumentWatermark: async () => null,
  saveContainerDocumentWatermark: async () => {},
};

type DiscoveryParentLaneRequest = Parameters<
  ContainerDocumentDiscoveryApi["listContainerParentLanes"]
>[0]["lanes"][number];

export function createDiscoveryParentLaneBatchMock(
  resolveLane: (
    input: Omit<DiscoveryParentLaneRequest, "laneId">,
  ) => Promise<ListContainersResponse | null>,
  onBatch?:
    | ((lanes: ReadonlyArray<DiscoveryParentLaneRequest>) => void)
    | undefined,
): ContainerDocumentDiscoveryApi["listContainerParentLanes"] {
  return async ({ lanes }) => {
    onBatch?.(lanes);
    const pages = await Promise.all(
      lanes.map(({ laneId: _laneId, ...lane }) => resolveLane(lane)),
    );
    const results = [];
    for (const [index, lane] of lanes.entries()) {
      const page = pages[index];
      if (!page) {
        return null;
      }
      results.push({ laneId: lane.laneId, page });
    }
    return { results };
  };
}
