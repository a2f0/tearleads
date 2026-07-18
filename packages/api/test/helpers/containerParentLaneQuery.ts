import type { ListContainerParentLanesRequest } from "@tearleads/validators/request";
import {
  isListContainerParentLanesResponse,
  type ListContainersResponse,
} from "@tearleads/validators/response";
import { routeApp } from "../../src/routeApp";

type ParentLaneRequest = Omit<
  ListContainerParentLanesRequest["lanes"][number],
  "watermark"
> & {
  readonly watermark?:
    | ListContainerParentLanesRequest["lanes"][number]["watermark"]
    | undefined;
};

export function requestContainerParentLanes(
  token: string,
  lanes: ReadonlyArray<ParentLaneRequest>,
): Promise<Response> {
  return Promise.resolve(
    routeApp.request("/containers/parent-lanes/query", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        lanes: lanes.map((lane) => ({
          ...lane,
          watermark: lane.watermark ?? null,
        })),
      }),
    }),
  );
}

export function requestSingleContainerParentLane(input: {
  readonly parentId?: string | null | undefined;
  readonly token: string;
  readonly watermark?:
    | { readonly id: string; readonly updatedAt: string }
    | null
    | undefined;
}): Promise<Response> {
  const parentId = input.parentId ?? null;
  return requestContainerParentLanes(input.token, [
    {
      laneId: parentId ?? "root",
      parentId,
      watermark: input.watermark ?? null,
    },
  ]);
}

export async function readContainerParentLanePage(
  response: Response,
  laneId?: string,
): Promise<ListContainersResponse> {
  const body: unknown = await response.json();
  if (!isListContainerParentLanesResponse(body)) {
    throw new Error("Expected a container parent-lane response");
  }
  const result =
    laneId === undefined
      ? body.results.length === 1
        ? body.results[0]
        : undefined
      : body.results.find((candidate) => candidate.laneId === laneId);
  if (!result) {
    throw new Error(
      laneId === undefined
        ? "Expected one container parent lane"
        : `Expected container parent lane ${laneId}`,
    );
  }
  return result.page;
}

export function firstContainerTombstone(page: ListContainersResponse) {
  const tombstone = page.tombstones[0];
  if (!tombstone) {
    throw new Error("Expected a container tombstone");
  }
  return tombstone;
}
