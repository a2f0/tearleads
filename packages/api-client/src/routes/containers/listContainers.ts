import {
  isListContainersResponse,
  type ListContainersResponse,
  type SyncWatermark,
} from "@tearleads/validators/response";
import type { RequestFn } from "../../types";
import { appendOptionalWatermark, appendQuery } from "./queryParams";

export interface ListContainersOptions {
  limit?: number;
  parentId?: string | null;
  watermark?: SyncWatermark | null;
}

export function listContainers(
  request: RequestFn,
  options: ListContainersOptions = {},
) {
  const params = new URLSearchParams();
  appendOptionalWatermark(params, options.watermark);
  if (options.parentId !== undefined) {
    params.set("parentId", options.parentId ?? "null");
  }
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }

  return request<ListContainersResponse>(
    appendQuery("/containers", params),
    isListContainersResponse,
    "GET",
  );
}
