import {
  type ContainerDocumentSummary,
  isListContainerDocumentsResponse,
  type ListContainerDocumentsResponse,
  type SyncWatermark,
} from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

type ListContainerDocumentsResult =
  | ListContainerDocumentsResponse
  | ContainerDocumentSummary[];

export interface ListContainerDocumentsOptions {
  limit?: number;
  watermark?: SyncWatermark | null;
}

function appendQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query.length === 0 ? path : `${path}?${query}`;
}

export function listContainerDocuments(
  request: RequestFn,
  containerId: string,
  options: ListContainerDocumentsOptions = {},
) {
  const params = new URLSearchParams();
  if (options.watermark) {
    params.set("watermarkUpdatedAt", options.watermark.updatedAt);
    params.set("watermarkId", options.watermark.id);
  }
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }

  return request<ListContainerDocumentsResult>(
    appendQuery(`/containers/${containerId}/documents`, params),
    isListContainerDocumentsResponse,
    "GET",
  );
}
