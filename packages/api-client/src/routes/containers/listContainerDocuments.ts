import {
  isListContainerDocumentsResponse,
  type ListContainerDocumentsResponse,
  type SyncWatermark,
} from "@tearleads/validators/response";
import type { RequestFn } from "../../types";
import { pathSegment } from "../path";
import { appendOptionalWatermark, appendQuery } from "./queryParams";

export interface ListContainerDocumentsOptions {
  limit?: number;
  watermark?: SyncWatermark | null;
}

export function listContainerDocuments(
  request: RequestFn,
  containerId: string,
  options: ListContainerDocumentsOptions = {},
) {
  const params = new URLSearchParams();
  appendOptionalWatermark(params, options.watermark);
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }

  return request<ListContainerDocumentsResponse>(
    appendQuery(`/containers/${pathSegment(containerId)}/documents`, params),
    isListContainerDocumentsResponse,
    "GET",
  );
}
