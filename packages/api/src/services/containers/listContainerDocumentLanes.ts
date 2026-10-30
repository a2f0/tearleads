import type { ListContainerDocumentLanesRequest } from "@tearleads/validators/request";
import {
  CONTAINER_NOT_FOUND_ERROR_CODE,
  type ListContainerDocumentLanesResponse,
} from "@tearleads/validators/response";
import {
  ContainerWriterProjectionError,
  type PrincipalPolicyReferenceCache,
} from "../../workflows/containers/writerProjection/types";
import { KeyingReadAccessError } from "../../workflows/keyingReadAccess";
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
  lane: ContainerDocumentLane,
  principalPolicyCache: PrincipalPolicyReferenceCache,
): Promise<ContainerDocumentLaneResult> {
  try {
    return {
      laneId: lane.laneId,
      page: await listContainerDocuments(runtime, lane.containerId, userId, {
        ...(lane.limit === undefined ? {} : { limit: lane.limit }),
        principalPolicyCache,
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
 * bound. The lanes share one request-scoped cache of verified principal
 * policies by reference, so a policy several lanes cite loads once; every
 * lane still verifies its own container path.
 */
export async function listContainerDocumentLanes(
  runtime: ApiServiceRuntime,
  userId: string,
  request: ListContainerDocumentLanesRequest,
): Promise<ListContainerDocumentLanesResponse> {
  const results: ContainerDocumentLaneResult[] = [];
  const principalPolicyCache: PrincipalPolicyReferenceCache = new Map();
  const pending = request.lanes.map((lane, index) => ({ index, lane }));
  const worker = async () => {
    for (let next = pending.shift(); next; next = pending.shift()) {
      results[next.index] = await listContainerDocumentLane(
        runtime,
        userId,
        next.lane,
        principalPolicyCache,
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
