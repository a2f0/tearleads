import type { ListContainerParentLanesRequest } from "@tearleads/validators/request";
import type { ListContainerParentLanesResponse } from "@tearleads/validators/response";
import type { ApiServiceRuntime } from "../runtime";
import { listContainers } from "./listContainers";

export async function listContainerParentLanes(
  runtime: ApiServiceRuntime,
  userId: string,
  request: ListContainerParentLanesRequest,
): Promise<ListContainerParentLanesResponse> {
  const results = await Promise.all(
    request.lanes.map(async (lane) => ({
      laneId: lane.laneId,
      page: await listContainers(runtime, userId, {
        ...(lane.limit === undefined ? {} : { limit: lane.limit }),
        parentId: lane.parentId,
        ...(lane.watermark === null ? {} : { watermark: lane.watermark }),
      }),
    })),
  );

  return { results };
}
