import type { ListContainerDocumentLanesRequest } from "@tearleads/validators/request";
import {
  CONTAINER_NOT_FOUND_ERROR_CODE,
  type ListContainerDocumentLanesResponse,
} from "@tearleads/validators/response";
import type { ApiServiceRuntime } from "../runtime";
import {
  ListContainerDocumentsError,
  listContainerDocuments,
} from "./listContainerDocuments";

/** Lanes listed at once; the same bound the client applied to singular reads. */
const CONTAINER_DOCUMENT_LANE_CONCURRENCY = 4;

type ContainerDocumentLane = ListContainerDocumentLanesRequest["lanes"][number];
type ContainerDocumentLaneResult =
  ListContainerDocumentLanesResponse["results"][number];

async function listContainerDocumentLane(
  runtime: ApiServiceRuntime,
  userId: string,
  lane: ContainerDocumentLane,
): Promise<ContainerDocumentLaneResult> {
  try {
    return {
      laneId: lane.laneId,
      page: await listContainerDocuments(runtime, lane.containerId, userId, {
        ...(lane.limit === undefined ? {} : { limit: lane.limit }),
        watermark: lane.watermark,
      }),
    };
  } catch (error) {
    // A malformed lane is a malformed request; a rejected container is not.
    if (!(error instanceof ListContainerDocumentsError) || error.status === 400)
      throw error;
    return {
      failure: {
        ...(error.status === 404
          ? { code: CONTAINER_NOT_FOUND_ERROR_CODE }
          : {}),
        error: error.message,
        status: error.status,
      },
      laneId: lane.laneId,
    };
  }
}

/**
 * Lists each requested container independently through the singular listing:
 * the same readable-container gate, access resolver, watermark, and page
 * bound. Batching claims fewer requests, not fewer statements per lane.
 */
export async function listContainerDocumentLanes(
  runtime: ApiServiceRuntime,
  userId: string,
  request: ListContainerDocumentLanesRequest,
): Promise<ListContainerDocumentLanesResponse> {
  const results: ContainerDocumentLaneResult[] = [];
  const pending = request.lanes.map((lane, index) => ({ index, lane }));
  const worker = async () => {
    for (let next = pending.shift(); next; next = pending.shift()) {
      results[next.index] = await listContainerDocumentLane(
        runtime,
        userId,
        next.lane,
      );
    }
  };
  await Promise.all(
    Array.from(
      {
        length: Math.min(
          CONTAINER_DOCUMENT_LANE_CONCURRENCY,
          request.lanes.length,
        ),
      },
      worker,
    ),
  );
  return { results };
}
