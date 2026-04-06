import { isListContainerDocumentsResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function listContainerDocuments(
  request: RequestFn,
  containerId: string,
) {
  return request(
    `/containers/${containerId}/documents`,
    isListContainerDocumentsResponse,
    "GET",
  );
}
