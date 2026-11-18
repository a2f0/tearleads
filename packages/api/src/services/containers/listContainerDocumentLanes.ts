import type { ListContainerDocumentLanesRequest } from "@tearleads/validators/request";
import {
  CONTAINER_NOT_FOUND_ERROR_CODE,
  type ListContainerDocumentLanesResponse,
} from "@tearleads/validators/response";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { prefetchContainerAccessPaths } from "../../workflows/containers/writerProjection/accessPaths";
import {
  type ContainerWriterProjectionContext,
  ContainerWriterProjectionError,
} from "../../workflows/containers/writerProjection/types";
import { KeyingReadAccessError } from "../../workflows/keyingReadAccess";
import type { ApiServiceRuntime } from "../runtime";
import { discoveryCursor } from "./discoveryCursor";
import { discoveryWalPosition, readDiscoveryKey } from "./discoverySnapshot";
import {
  ListContainerDocumentsError,
  listContainerDocuments,
} from "./listContainerDocuments";
import { createContainerWriterProjectionContext } from "./writerProjection";

/** Lanes listed at once; the same bound the client applied to singular reads. */
const CONTAINER_DOCUMENT_LANE_CONCURRENCY = 4;

type ContainerDocumentLane = ListContainerDocumentLanesRequest["lanes"][number];
type ContainerDocumentLaneResult =
  ListContainerDocumentLanesResponse["results"][number];
type ContainerDocumentLaneFailure = Extract<
  ContainerDocumentLaneResult,
  { failure: unknown }
>["failure"];

/**
 * The lane-local form of a container access decision. The lane container's
 * own gate keeps the singular route's mapping: its status, with the exact
 * absence code only on 404. An access decision about a container a listed
 * document also links into (a conflict while resolving its path) belongs to
 * this lane alone and never carries the lane container's absence code. Any
 * other error, including a malformed lane (400), fails the request.
 */
function containerDocumentLaneFailure(
  error: unknown,
): ContainerDocumentLaneFailure | null {
  if (error instanceof ListContainerDocumentsError) {
    if (error.status === 400) return null;
    return {
      ...(error.status === 404 ? { code: CONTAINER_NOT_FOUND_ERROR_CODE } : {}),
      error: error.message,
      status: error.status,
    };
  }
  if (
    error instanceof KeyingReadAccessError ||
    error instanceof ContainerWriterProjectionError
  ) {
    return { error: error.message, status: error.status };
  }
  return null;
}

async function listContainerDocumentLane(
  runtime: ApiServiceRuntime,
  userId: string,
  discoveryKey: string,
  lane: ContainerDocumentLane,
  context: ContainerWriterProjectionContext,
): Promise<ContainerDocumentLaneResult> {
  try {
    return {
      laneId: lane.laneId,
      page: await listContainerDocuments(runtime, lane.containerId, userId, {
        ...(lane.limit === undefined ? {} : { limit: lane.limit }),
        context,
        discoveryKey,
        watermark: lane.watermark,
      }),
    };
  } catch (error) {
    const failure = containerDocumentLaneFailure(error);
    if (!failure) throw error;
    return { failure, laneId: lane.laneId };
  }
}

/**
 * Lists each requested container independently through the singular listing:
 * the same readable-container gate, access resolver, watermark, and page
 * bound. One request-scoped context shares identical manifest verification
 * and principal policies; every distinct path still passes the same checks.
 */
export async function listContainerDocumentLanes(
  runtime: ApiServiceRuntime,
  userId: string,
  request: ListContainerDocumentLanesRequest,
): Promise<ListContainerDocumentLanesResponse> {
  const proof = request.afterParentPage;
  if (!proof)
    return listLanes(runtime, userId, request, await readDiscoveryKey(runtime));
  // Keep the floor and subsequent authorization reads on one connection.
  // READ COMMITTED takes a new snapshot after the replay position was checked.
  return runtime.db.transaction(
    async (tx) => {
      const pinned = { ...runtime, db: tx };
      const key = await readDiscoveryKey(pinned);
      const floor = discoveryCursor(
        key,
        [userId, "containers", proof.parentId],
        proof.watermark,
      ).walPosition;
      if (!floor)
        throw new ListContainerDocumentsError(
          "Invalid parent page checkpoint",
          400,
        );
      const reached = await tx.execute(
        sql`select ${discoveryWalPosition} >= ${floor}::pg_lsn as reached`,
      );
      if (
        !z.object({ reached: z.literal(true) }).safeParse(reached.rows[0])
          .success
      )
        throw new ListContainerDocumentsError(
          "Parent page checkpoint has not been reached",
          409,
        );
      return listLanes(pinned, userId, request, key);
    },
    { isolationLevel: "read committed", accessMode: "read only" },
  );
}

async function listLanes(
  runtime: ApiServiceRuntime,
  userId: string,
  request: ListContainerDocumentLanesRequest,
  discoveryKey: string,
): Promise<ListContainerDocumentLanesResponse> {
  const results: ContainerDocumentLaneResult[] = [];
  const context: ContainerWriterProjectionContext = {
    ...createContainerWriterProjectionContext(runtime.db),
    principalPolicyByReference: new Map(),
  };
  await prefetchContainerAccessPaths(
    context,
    request.lanes.map((lane) => lane.containerId),
  );
  const pending = request.lanes.map((lane, index) => ({ index, lane }));
  const worker = async () => {
    for (let next = pending.shift(); next; next = pending.shift()) {
      results[next.index] = await listContainerDocumentLane(
        runtime,
        userId,
        discoveryKey,
        next.lane,
        context,
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
