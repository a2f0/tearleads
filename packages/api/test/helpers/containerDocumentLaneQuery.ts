import { isListContainerDocumentLanesOperationResponse } from "@tearleads/validators/operation";
import type {
  ListContainerDocumentLanesResponse,
  ListContainerDocumentsResponse,
} from "@tearleads/validators/response";
import { routeApp } from "../../src/routeApp";

type ContainerDocumentLaneResult =
  ListContainerDocumentLanesResponse["results"][number];

interface ContainerDocumentLaneInput {
  readonly containerId: string;
  readonly laneId?: string | undefined;
  readonly limit?: number | undefined;
  readonly watermark?:
    | { readonly id: string; readonly updatedAt: string }
    | null
    | undefined;
}

/** POSTs one batched document listing; lane ids default to their index. */
export function requestContainerDocumentLanes(
  token: string,
  lanes: ReadonlyArray<ContainerDocumentLaneInput>,
): Promise<Response> {
  return Promise.resolve(
    routeApp.request("/containers/documents/query", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        lanes: lanes.map((lane, index) => ({
          containerId: lane.containerId,
          laneId: lane.laneId ?? `lane-${index}`,
          ...(lane.limit === undefined ? {} : { limit: lane.limit }),
          watermark: lane.watermark ?? null,
        })),
      }),
    }),
  );
}

export async function readContainerDocumentLaneResults(
  response: Response,
): Promise<ReadonlyArray<ContainerDocumentLaneResult>> {
  if (response.status !== 200) {
    throw new Error(
      `Expected a container document-lane response, got ${response.status}`,
    );
  }
  const body: unknown = await response.json();
  if (!isListContainerDocumentLanesOperationResponse(body)) {
    throw new Error("Expected a container document-lane response");
  }
  return body.results;
}

/** Lists one container through a single-lane batch and returns its result. */
export async function listContainerDocumentLane(
  token: string,
  lane: ContainerDocumentLaneInput,
): Promise<ContainerDocumentLaneResult> {
  const [result, ...rest] = await readContainerDocumentLaneResults(
    await requestContainerDocumentLanes(token, [lane]),
  );
  if (!result || rest.length > 0) {
    throw new Error("Expected one container document lane");
  }
  return result;
}

export async function listContainerDocumentPage(
  token: string,
  lane: ContainerDocumentLaneInput,
): Promise<ListContainerDocumentsResponse> {
  const result = await listContainerDocumentLane(token, lane);
  if (!("page" in result)) {
    throw new Error(
      `Expected a listed container document lane, got ${result.failure.status}`,
    );
  }
  return result.page;
}
