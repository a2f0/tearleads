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
 * Lanes listed at once inside the batch's single repeatable-read snapshot
 * transaction. A single PostgreSQL transaction runs on one connection, so
 * lanes execute serially against the shared snapshot and shared projection
 * context without backward MVCC skew.
 */
const CONTAINER_PARENT_LANE_CONCURRENCY = 1;

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
          context,
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
 * the same access resolver, watermark and page bound. Multi-lane batches run
 * inside one read-only repeatable-read snapshot so prefetched ancestor paths,
 * candidate scans, and manifest verification cannot observe backward MVCC skew
 * across concurrent shares or moves. Single-lane requests need neither
 * pre-scan prefetching nor a cross-lane cache, so they avoid transaction
 * control overhead and match the singular route's forward-only MVCC path.
 * Results follow the request's lane order, and lane-local access/consistency
 * errors fail only their own lane.
 */
export async function listContainerParentLanes(
  runtime: ApiServiceRuntime,
  userId: string,
  request: ListContainerParentLanesRequest,
): Promise<ListContainerParentLanesResponse> {
  if (request.lanes.length === 1) {
    const [lane] = request.lanes;
    if (!lane) return { results: [] };
    const discoveryKey = await readDiscoveryKey(runtime);
    const context: ContainerWriterProjectionContext = {
      ...createContainerWriterProjectionContext(runtime.db),
      principalPolicyByReference: new Map(),
    };
    return {
      results: [
        await listContainerParentLane(
          runtime,
          userId,
          discoveryKey,
          lane,
          context,
        ),
      ],
    };
  }
  return runtime.db.transaction(
    async (tx) => {
      const pinned: ApiServiceRuntime = { ...runtime, db: tx };
      const discoveryKey = await readDiscoveryKey(pinned);
      const context: ContainerWriterProjectionContext = {
        ...createContainerWriterProjectionContext(tx),
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
          listContainerParentLane(pinned, userId, discoveryKey, lane, context),
      );
      return { results };
    },
    { accessMode: "read only", isolationLevel: "repeatable read" },
  );
}
