import type { ListContainerParentLanesRequest } from "@tearleads/validators/request";
import {
  CONTAINER_NOT_FOUND_ERROR_CODE,
  type ListContainerParentLanesResponse,
} from "@tearleads/validators/response";
import { prefetchContainerAccessPaths } from "../../workflows/containers/writerProjection/accessPaths";
import {
  type ContainerWriterProjectionContext,
  ContainerWriterProjectionError,
} from "../../workflows/containers/writerProjection/types";
import { KeyingReadAccessError } from "../../workflows/keyingReadAccess";
import type { ApiServiceRuntime } from "../runtime";
import { mapLanesBounded } from "./boundedLaneWork";
import { readDiscoveryKey } from "./discoverySnapshot";
import { listContainerIdsOnly, listContainers } from "./listContainers";
import { createContainerWriterProjectionContext } from "./writerProjection";

/**
 * Lanes listed at once. A request may name 32 lanes; this is the most one
 * could name before, so batching more lanes into a request does not raise
 * the database work one request holds at a time.
 */
const CONTAINER_PARENT_LANE_CONCURRENCY = 4;

type ContainerParentLane = ListContainerParentLanesRequest["lanes"][number];
type ContainerParentLaneResult =
  ListContainerParentLanesResponse["results"][number];
type ContainerParentLaneFailure = Extract<
  ContainerParentLaneResult,
  { failure: unknown }
>["failure"];

/**
 * Maps lane-local access or consistency errors onto a per-lane failure so one
 * corrupted or unreadable lane does not abort sibling lanes in the same batch.
 * Malformed requests (400) and unexpected errors still fail the request.
 */
function containerParentLaneFailure(
  error: unknown,
): ContainerParentLaneFailure | null {
  if (error instanceof ContainerWriterProjectionError) {
    return {
      ...(error.status === 404 && error.code === CONTAINER_NOT_FOUND_ERROR_CODE
        ? { code: CONTAINER_NOT_FOUND_ERROR_CODE }
        : {}),
      error: error.message,
      status: error.status,
    };
  }
  if (error instanceof KeyingReadAccessError) {
    return { error: error.message, status: error.status };
  }
  return null;
}

async function listContainerParentLane(
  runtime: ApiServiceRuntime,
  userId: string,
  discoveryKey: string,
  lane: ContainerParentLane,
  context: ContainerWriterProjectionContext,
): Promise<ContainerParentLaneResult> {
  try {
    if (lane.idsOnly) {
      return {
        idsPage: await listContainerIdsOnly(runtime, userId, {
          discoveryKey,
          ...(lane.limit === undefined ? {} : { limit: lane.limit }),
          parentId: lane.parentId,
          ...(lane.watermark === null ? {} : { watermark: lane.watermark }),
        }),
        laneId: lane.laneId,
      };
    }
    return {
      laneId: lane.laneId,
      page: await listContainers(runtime, userId, {
        context,
        discoveryKey,
        ...(lane.limit === undefined ? {} : { limit: lane.limit }),
        parentId: lane.parentId,
        ...(lane.watermark === null ? {} : { watermark: lane.watermark }),
      }),
    };
  } catch (error) {
    const failure = containerParentLaneFailure(error);
    if (!failure) throw error;
    return { failure, laneId: lane.laneId };
  }
}

/**
 * Lists each requested parent independently through the singular listing:
 * the same access resolver, watermark and page bound. One request-scoped
 * projection context shares prefetched ancestor paths, manifest verification,
 * and principal policies across all lanes. Results follow the request's lane
 * order, and lane-local access/consistency errors fail only their own lane.
 */
export async function listContainerParentLanes(
  runtime: ApiServiceRuntime,
  userId: string,
  request: ListContainerParentLanesRequest,
): Promise<ListContainerParentLanesResponse> {
  const discoveryKey = await readDiscoveryKey(runtime);
  const context: ContainerWriterProjectionContext = {
    ...createContainerWriterProjectionContext(runtime.db),
    principalPolicyByReference: new Map(),
  };
  const nonNullParentIds = request.lanes.flatMap((lane) =>
    lane.idsOnly || lane.parentId === null ? [] : [lane.parentId],
  );
  if (nonNullParentIds.length > 0) {
    await prefetchContainerAccessPaths(context, nonNullParentIds);
  }
  const results = await mapLanesBounded(
    request.lanes,
    CONTAINER_PARENT_LANE_CONCURRENCY,
    (lane) =>
      listContainerParentLane(runtime, userId, discoveryKey, lane, context),
  );

  return { results };
}
