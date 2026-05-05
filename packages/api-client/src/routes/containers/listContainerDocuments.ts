import {
  type ContainerDocumentSummary,
  isListContainerDocumentsResponse,
  type ListContainerDocumentsResponse,
  type SyncWatermark,
} from "@tearleads/validators/response";
import type { RequestFn } from "../../types";
import { appendOptionalWatermark, appendQuery } from "./queryParams";

type ListContainerDocumentsResult =
  | ListContainerDocumentsResponse
  | ContainerDocumentSummary[];

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

  return request<ListContainerDocumentsResult>(
    appendQuery(`/containers/${containerId}/documents`, params),
    isListContainerDocumentsResponse,
    "GET",
  );
}
