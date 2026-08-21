import type { ApiClient } from "@symcrypt/api-client";
import type { ListContainerParentLanesRequest } from "@symcrypt/validators/request";
import type { ListContainersResponse } from "@symcrypt/validators/response";

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
      results.push({ laneId: lane.laneId, page });
    }

    return { results };
  };
}
