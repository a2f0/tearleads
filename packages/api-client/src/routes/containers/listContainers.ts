import {
  type ContainerSummary,
  isListContainersResponse,
  type ListContainersResponse,
} from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

type ListContainersResult = ListContainersResponse | ContainerSummary[];

export interface ListContainersOptions {
  cursor?: string | null;
  depth?: number;
  limit?: number;
}

function appendQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query.length === 0 ? path : `${path}?${query}`;
}

export function listContainers(
  request: RequestFn,
  options: ListContainersOptions = {},
) {
  const params = new URLSearchParams();
  if (options.cursor) {
    params.set("cursor", options.cursor);
  }
  if (options.depth !== undefined) {
    params.set("depth", String(options.depth));
  }
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }

  return request<ListContainersResult>(
    appendQuery("/containers", params),
    isListContainersResponse,
    "GET",
  );
}
