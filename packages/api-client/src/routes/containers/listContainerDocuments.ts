import {
  type ContainerDocumentSummary,
  isListContainerDocumentsResponse,
  type ListContainerDocumentsResponse,
} from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

type ListContainerDocumentsResult =
  | ListContainerDocumentsResponse
  | ContainerDocumentSummary[];

export interface ListContainerDocumentsOptions {
  cursor?: string | null;
  limit?: number;
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
  if (options.cursor) {
    params.set("cursor", options.cursor);
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
