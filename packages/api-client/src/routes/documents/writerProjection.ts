import { isDocumentWriterProjectionResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function getDocumentWriterProjection(
  request: RequestFn,
  documentId: string,
) {
  return request(
    `/documents/${documentId}/writer-projection`,
    isDocumentWriterProjectionResponse,
    "GET",
  );
}
