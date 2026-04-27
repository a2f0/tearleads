import { isDocumentV2WriterProjectionResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function getDocumentV2WriterProjection(
  request: RequestFn,
  documentId: string,
) {
  return request(
    `/v2/documents/${documentId}/writer-projection`,
    isDocumentV2WriterProjectionResponse,
    "GET",
  );
}
