import { isDocumentWriterProjectionResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";
import { pathSegment } from "../path";

export function getDocumentWriterProjection(
  request: RequestFn,
  documentId: string,
) {
  return request(
    `/documents/${pathSegment(documentId)}/writer-projection`,
    isDocumentWriterProjectionResponse,
    "GET",
  );
}
