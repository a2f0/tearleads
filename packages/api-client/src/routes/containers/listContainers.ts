import {
  type ContainerSummary,
  isListContainersResponse,
  type ListContainersResponse,
  type SyncWatermark,
} from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

type ListContainersResult = ListContainersResponse | ContainerSummary[];

export interface ListContainersOptions {
  depth?: number;
  limit?: number;
  watermark?: SyncWatermark | null;
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
  if (options.watermark) {
    params.set("watermarkUpdatedAt", options.watermark.updatedAt);
    params.set("watermarkId", options.watermark.id);
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
