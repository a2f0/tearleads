import type { ApiClient } from "@tearleads/api-client";
import type { ListContainerParentLanesRequest } from "@tearleads/validators/request";
import type { ListContainersResponse } from "@tearleads/validators/response";

export type ContainerParentLaneBatchMockInput = Omit<
  ListContainerParentLanesRequest["lanes"][number],
  "laneId"
>;

export function createContainerParentLaneBatchMock(
  resolveLane: (
    input: ContainerParentLaneBatchMockInput,
  ) => Promise<ListContainersResponse | null>,
): ApiClient["listContainerParentLanes"] {
  return async (input) => {
    const pages = await Promise.all(
      input.lanes.map(({ laneId: _laneId, ...lane }) => resolveLane(lane)),
    );
    const results = [];
    for (const [index, lane] of input.lanes.entries()) {
      const page = pages[index];
      if (!page) {
        return null;
      }
      if (lane.idsOnly) {
        results.push({
          idsPage: {
            hasMore: page.hasMore,
            items: page.items.map((item) => ({
              directAccessLevel: item.effectiveAccessLevel,
              id: item.id,
              organizationId: item.organizationId,
              parentId: item.parentId,
              ...(item.systemSlot ? { systemSlot: item.systemSlot } : {}),
            })),
            nextWatermark: page.nextWatermark,
          },
          laneId: lane.laneId,
        });
      } else {
        results.push({ laneId: lane.laneId, page });
      }
    }

    return { results };
  };
}
