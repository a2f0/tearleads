import type { ListContainerParentLanesRequest } from "@tearleads/validators/request";
import type { ListContainerParentLanesResponse } from "@tearleads/validators/response";
import type { PrincipalPolicyReferenceCache } from "../../workflows/containers/writerProjection/types";
import type { ApiServiceRuntime } from "../runtime";
import { mapLanesBounded } from "./boundedLaneWork";
import { readDiscoveryKey } from "./discoverySnapshot";
import { listContainers } from "./listContainers";

/**
 * Lanes listed at once. A request may name 32 lanes; this is the most one
 * could name before, so batching more lanes into a request does not raise
 * the database work one request holds at a time.
 */
const CONTAINER_PARENT_LANE_CONCURRENCY = 4;

/**
 * Lists each requested parent independently through the singular listing:
 * the same access resolver, watermark and page bound. Results follow the
 * request's lane order. Any lane's failure fails the request.
 */
export async function listContainerParentLanes(
  runtime: ApiServiceRuntime,
  userId: string,
  request: ListContainerParentLanesRequest,
): Promise<ListContainerParentLanesResponse> {
  const discoveryKey = await readDiscoveryKey(runtime);
  const principalPolicyByReference: PrincipalPolicyReferenceCache = new Map();
  const results = await mapLanesBounded(
    request.lanes,
    CONTAINER_PARENT_LANE_CONCURRENCY,
    async (lane) => ({
      laneId: lane.laneId,
      page: await listContainers(runtime, userId, {
        principalPolicyByReference,
        discoveryKey,
        ...(lane.limit === undefined ? {} : { limit: lane.limit }),
        parentId: lane.parentId,
        ...(lane.watermark === null ? {} : { watermark: lane.watermark }),
      }),
    }),
  );

  return { results };
}
